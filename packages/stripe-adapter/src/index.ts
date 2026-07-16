import Stripe from "stripe";
import { z } from "zod";
import {
  ConfirmedExecutionFailure,
  PreSubmissionFailure,
  type ReconciliationOutcome,
  UnknownExecutionOutcome
} from "@writeguard/core";

export type StripeRefundAdapterOptions = {
  stripe: Stripe;
  paymentIntentId: string;
  amount?: number;
  currency?: string;
};

export class StripeRefundAdapter {
  private readonly stripe: Stripe;
  readonly paymentIntentId: string;
  readonly amount: number | undefined;
  readonly currency: string | undefined;

  constructor(options: StripeRefundAdapterOptions) {
    this.stripe = options.stripe;
    this.paymentIntentId = z.string().min(1).parse(options.paymentIntentId);
    this.amount = options.amount;
    this.currency = options.currency?.toLowerCase();
  }

  async execute(operationId: string): Promise<Stripe.Refund> {
    try {
      const params: Stripe.RefundCreateParams = {
        payment_intent: this.paymentIntentId,
        metadata: {
          write_guard_operation_id: operationId
        }
      };
      if (this.amount !== undefined) params.amount = this.amount;
      return await this.stripe.refunds.create(params, { idempotencyKey: operationId });
    } catch (error) {
      throw classifyStripeExecutionError(error);
    }
  }

  async reconcile(operationId: string): Promise<ReconciliationOutcome<Stripe.Refund>> {
    const matches: Stripe.Refund[] = [];
    for await (const refund of this.stripe.refunds.list({
      payment_intent: this.paymentIntentId,
      limit: 100
    })) {
      if (refund.metadata?.write_guard_operation_id === operationId) {
        matches.push(refund);
      }
    }

    const evidence = {
      paymentIntentId: this.paymentIntentId,
      operationId,
      matchCount: matches.length,
      expectedAmount: this.amount ?? null,
      expectedCurrency: this.currency ?? null,
      providerReferences: matches.map((refund) => refund.id)
    };
    if (matches.length === 0) return { kind: "not_found", evidence };
    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        providerReferences: matches.map((refund) => refund.id),
        evidence
      };
    }
    return { kind: "found", result: matches[0]!, evidence };
  }

  async verify(refund: Stripe.Refund, operationId: string): Promise<boolean> {
    return (
      refund.status === "succeeded" &&
      refund.payment_intent === this.paymentIntentId &&
      refund.metadata?.write_guard_operation_id === operationId &&
      (this.amount === undefined || refund.amount === this.amount) &&
      (this.currency === undefined || refund.currency === this.currency)
    );
  }

  verificationEvidence(refund: Stripe.Refund): Record<string, unknown> {
    return {
      provider: "stripe",
      refundId: refund.id,
      refundStatus: refund.status,
      refundAmount: refund.amount,
      refundCurrency: refund.currency,
      paymentIntentId: refund.payment_intent,
      amountMatches: this.amount === undefined || refund.amount === this.amount,
      currencyMatches: this.currency === undefined || refund.currency === this.currency,
      operationMetadataMatches:
        typeof refund.metadata?.write_guard_operation_id === "string" &&
        refund.metadata.write_guard_operation_id.length > 0
    };
  }
}

export function classifyStripeExecutionError(error: unknown): Error {
  if (!(error instanceof Stripe.errors.StripeError)) {
    return new UnknownExecutionOutcome("Unexpected Stripe SDK error with an ambiguous submission result", {
      cause: error
    });
  }

  switch (error.type) {
    case "StripeConnectionError":
    case "StripeAPIError":
      return new UnknownExecutionOutcome(
        "Stripe request failed at the transport or API layer after submission may have occurred",
        { cause: error }
      );
    case "StripeAuthenticationError":
    case "StripePermissionError":
      return new PreSubmissionFailure("Stripe rejected the request before the refund could be submitted", {
        cause: error
      });
    case "StripeCardError":
    case "StripeInvalidGrantError":
    case "StripeInvalidRequestError":
    case "StripeIdempotencyError":
    case "StripeRateLimitError":
    case "StripeSignatureVerificationError":
      return new ConfirmedExecutionFailure("Stripe explicitly rejected the refund request", { cause: error });
    default:
      return new UnknownExecutionOutcome("Stripe returned an unclassified error after submission may have occurred", {
        cause: error
      });
  }
}

export type TestPaymentIntentOptions = {
  existingPaymentIntentId?: string;
  amount: number;
  currency: string;
  minimumRefundableAmount?: number;
};

export async function createOrReuseTestPaymentIntent(
  stripe: Stripe,
  options: TestPaymentIntentOptions
): Promise<Stripe.PaymentIntent> {
  if (options.existingPaymentIntentId) {
    const existing = await stripe.paymentIntents.retrieve(options.existingPaymentIntentId);
    if (existing.status !== "succeeded") {
      throw new Error(`Stripe PaymentIntent ${existing.id} is ${existing.status}, not succeeded`);
    }
    if (existing.currency !== options.currency.toLowerCase()) {
      throw new Error(
        `Stripe PaymentIntent ${existing.id} uses ${existing.currency}, not ${options.currency.toLowerCase()}`
      );
    }
    let alreadyRefunded = 0;
    for await (const refund of stripe.refunds.list({ payment_intent: existing.id, limit: 100 })) {
      if (refund.status !== "failed" && refund.status !== "canceled") alreadyRefunded += refund.amount;
    }
    const refundable = existing.amount_received - alreadyRefunded;
    if (
      options.minimumRefundableAmount !== undefined &&
      refundable < options.minimumRefundableAmount
    ) {
      throw new Error(
        `Stripe PaymentIntent ${existing.id} has ${refundable} refundable minor units; ` +
          `${options.minimumRefundableAmount} are required`
      );
    }
    return existing;
  }

  return stripe.paymentIntents.create({
    amount: options.amount,
    currency: options.currency,
    payment_method: "pm_card_visa",
    payment_method_types: ["card"],
    confirm: true,
    description: "WriteGuard transactional reliability test payment",
    metadata: {
      created_by: "closure_writeguard_demo"
    }
  });
}

export function assertStripeTestModeKey(value: string | undefined): string {
  if (!value) throw new Error("STRIPE_SECRET_KEY is required for demo:stripe");
  const key = value;
  if (!key.startsWith("sk_test_")) {
    throw new Error("The Stripe validation only accepts a test-mode sk_test_ key");
  }
  return key;
}

export { Stripe };
