import { createHash } from "node:crypto";
import {
  createLocalPilotTelemetry,
  createPostgresStorage,
  createWriteGuard
} from "@closure/writeguard";
import {
  createOrReuseTestPaymentIntent,
  Stripe,
  StripeRefundAdapter
} from "@writeguard/stripe-adapter";
import type { PilotConfig } from "./config.js";
import { setupPilotState } from "./state.js";

export async function runStripePilotScenario(config: PilotConfig): Promise<{
  mode: "enforced";
  provider: "stripe-test";
  operationKeyHash: string;
  frameworkInvocations: 2;
  finalStatus: string;
  sameReceiptReturned: boolean;
}> {
  if (config.provider !== "stripe-test" || config.mode !== "enforced" || !config.stripe.secretKey) {
    throw new Error("Stripe test scenario requires validated enforced Stripe test configuration.");
  }
  await setupPilotState(config);
  const stripe = new Stripe(config.stripe.secretKey);
  const paymentIntent = await createOrReuseTestPaymentIntent(stripe, {
    ...(config.stripe.paymentIntentId
      ? { existingPaymentIntentId: config.stripe.paymentIntentId }
      : {}),
    amount: config.stripe.paymentIntentAmount,
    currency: config.stripe.currency,
    minimumRefundableAmount: config.stripe.refundAmount
  });
  const adapter = new StripeRefundAdapter({
    stripe,
    paymentIntentId: paymentIntent.id,
    amount: config.stripe.refundAmount,
    currency: config.stripe.currency
  });
  const storage = createPostgresStorage({ connectionString: config.databaseUrl });
  const telemetry = config.telemetryEnabled
    ? createLocalPilotTelemetry({ filePath: config.telemetryFile })
    : undefined;
  const writeGuard = createWriteGuard({
    storage,
    namespace: config.namespace,
    ...(telemetry ? { telemetry } : {})
  });
  const operationKey = `stripe-refund:${paymentIntent.id}:${config.stripe.refundAmount}:${config.stripe.currency}`;
  const run = (toolCallId: string) =>
    writeGuard.execute({
      key: operationKey,
      action: { name: "refund_order", provider: "stripe", effectType: "irreversible_write" },
      fingerprint: {
        paymentIntentId: paymentIntent.id,
        amount: config.stripe.refundAmount,
        currency: config.stripe.currency
      },
      metadata: { workflow: "pilot_sandbox_stripe" },
      invocation: { framework: "mcp", toolName: "refund_order", toolCallId },
      execute: (context) => adapter.execute(context.operationId),
      reconcile: (context) => adapter.reconcile(context.operationId),
      verify: (refund, context) => adapter.verify(refund, context.operationId),
      getProviderReference: (refund) => refund.id,
      getVerificationEvidence: (refund) => adapter.verificationEvidence(refund)
    });
  try {
    const first = await run("call_A");
    const second = await run("call_B");
    return {
      mode: "enforced",
      provider: "stripe-test",
      operationKeyHash: createHash("sha256").update(operationKey).digest("hex").slice(0, 16),
      frameworkInvocations: 2,
      finalStatus: second.status,
      sameReceiptReturned: first.id === second.id
    };
  } finally {
    await storage.close();
  }
}
