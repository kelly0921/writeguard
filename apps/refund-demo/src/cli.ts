import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import {
  classifyError,
  fakeProviderScenarios,
  PostgresFakeRefundProvider,
  PostgresOperationStore,
  type FakeProviderScenario,
  type FakeRefund,
  type OperationTimeline,
  UnknownExecutionOutcome
} from "@writeguard/core";
import { WriteGuard, type WriteGuardExecutionOptions } from "@writeguard/sdk";
import {
  assertStripeTestModeKey,
  createOrReuseTestPaymentIntent,
  Stripe,
  StripeRefundAdapter
} from "@writeguard/stripe-adapter";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://closure:closure@localhost:54327/closure";
const namespace = process.env.WRITEGUARD_NAMESPACE ?? "local-demo";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(31)} ${String(value)}`);
}

function renderTimeline(timeline: OperationTimeline): void {
  console.log(`\nOperation: ${timeline.operation.operationKey}`);
  for (const event of timeline.events) {
    const marker = event.newStatus === "UNKNOWN" || event.newStatus === "NEEDS_REVIEW" ? "!" : "+";
    console.log(`${marker} ${event.newStatus.padEnd(14)} ${event.eventType}`);
  }
  if (timeline.receipt) {
    console.log("\nReceipt");
    line("Status", timeline.receipt.status);
    line("Provider result", timeline.receipt.providerReference ?? "none");
    line("Attempts", timeline.receipt.attempts);
    line("Duplicate execution prevented", timeline.receipt.duplicateExecutionPrevented);
    line("Resolution", timeline.receipt.resolution);
  }
}

function fakeOptions(
  provider: PostgresFakeRefundProvider,
  operationKey: string,
  paymentIntentId: string,
  injectAfterSuccess: boolean
): WriteGuardExecutionOptions<FakeRefund> {
  return {
    key: operationKey,
    action: {
      name: "fake.refund.create",
      provider: "fake-payments",
      effectType: "irreversible_write"
    },
    fingerprint: { paymentIntentId, amount: 500, currency: "usd" },
    metadata: {
      paymentIntentId,
      amount: 500,
      currency: "usd",
      customerEmail: "demo@example.test"
    },
    sensitiveFields: ["customerEmail"],
    execute: (context) =>
      provider.createRefund({
        operationId: context.operationId,
        paymentIntentId,
        amount: 500,
        currency: "usd"
      }),
    reconcile: (context) => provider.reconcile(context.operationId, paymentIntentId),
    verify: async (refund, context) =>
      refund.status === "succeeded" &&
      refund.paymentIntentId === paymentIntentId &&
      refund.operationId === context.operationId,
    getProviderReference: (refund) => refund.id,
    getVerificationEvidence: (refund) => ({
      provider: "fake-payments",
      refundId: refund.id,
      refundStatus: refund.status,
      operationMetadataMatches: refund.metadata.write_guard_operation_id === refund.operationId
    }),
    faults: { throwAfterExternalSuccess: injectAfterSuccess }
  };
}

async function runOrdinaryRetry(pool: pg.Pool): Promise<void> {
  const paymentIntentId = `pi_ordinary_${Date.now()}`;
  const provider = new PostgresFakeRefundProvider(pool, { scenario: "timeout_after_success" });
  const request = {
    operationId: randomUUID(),
    paymentIntentId,
    amount: 500,
    currency: "usd"
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await provider.createRefund(request);
    } catch (error) {
      line(`Ordinary attempt ${attempt}`, classifyError(error).type);
    }
  }
  const count = await provider.countRefunds(paymentIntentId);
  console.log("\nOrdinary retry behavior");
  line("External refunds created", count);
  line("Result", count > 1 ? "DUPLICATE EXTERNAL ACTION" : "single action");
}

async function runFakeDemo(pool: pg.Pool): Promise<void> {
  const scenario = z.enum(fakeProviderScenarios).parse(arg("scenario") ?? "success") as FakeProviderScenario;
  const reconciliationDelayMs = Number(arg("delay-ms") ?? 250);
  const paymentIntentId = `pi_fake_${Date.now()}`;
  const operationKey = `tenant_demo:${paymentIntentId}:refund`;
  const provider = new PostgresFakeRefundProvider(pool, { scenario, reconciliationDelayMs });
  const store = new PostgresOperationStore(pool);
  const guard = new WriteGuard({ store, namespace, pollIntervalMs: 20, waitTimeoutMs: 5_000 });
  const injectAfterSuccess = scenario === "success" || scenario === "delayed_reconciliation" || scenario === "conflicting_results";
  const options = fakeOptions(provider, operationKey, paymentIntentId, injectAfterSuccess);

  console.log("WriteGuard behavior");
  line("Scenario", scenario);
  line("Operation key", operationKey);

  let receipt;
  try {
    receipt = await guard.execute(options);
  } catch (error) {
    if (!(error instanceof UnknownExecutionOutcome)) throw error;
    line("First invocation", "UNKNOWN after external success");
  }

  if (!receipt) {
    try {
      receipt = await guard.execute(options);
    } catch (error) {
      if (scenario !== "delayed_reconciliation") throw error;
      line("Second invocation", "reconciliation temporarily unavailable; still UNKNOWN");
      await new Promise((resolve) => setTimeout(resolve, reconciliationDelayMs + 25));
      receipt = await guard.execute(options);
    }
  }

  const refundCount = await provider.countRefunds(paymentIntentId);
  const timeline = await store.getTimeline(namespace, operationKey);
  if (!timeline) throw new Error("Demo operation timeline was not persisted");
  renderTimeline(timeline);
  line("External refunds created", refundCount);
  line("Duplicate external writes", Math.max(0, refundCount - 1));
  if (receipt.status === "CONFIRMED" && refundCount !== 1) {
    throw new Error(`Invariant failed: confirmed receipt but ${refundCount} refunds exist`);
  }
}

async function runStripeDemo(pool: pg.Pool): Promise<void> {
  const secretKey = assertStripeTestModeKey(process.env.STRIPE_SECRET_KEY);
  const amount = Number(process.env.STRIPE_REFUND_AMOUNT ?? 100);
  const currency = (process.env.STRIPE_CURRENCY ?? "usd").toLowerCase();
  const paymentIntentAmount = Number(
    process.env.STRIPE_PAYMENT_INTENT_AMOUNT ?? Math.max(500, amount * 4)
  );
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("STRIPE_REFUND_AMOUNT must be a positive integer");
  if (!Number.isInteger(paymentIntentAmount) || paymentIntentAmount < amount * 3) {
    throw new Error("STRIPE_PAYMENT_INTENT_AMOUNT must cover two unsafe refunds and one guarded refund");
  }
  const stripe = new Stripe(secretKey, { telemetry: false });
  const paymentIntentOptions = {
    amount: paymentIntentAmount,
    currency,
    minimumRefundableAmount: amount * 3
  };
  const existingPaymentIntentId = process.env.STRIPE_PAYMENT_INTENT_ID;
  const paymentIntent = await createOrReuseTestPaymentIntent(
    stripe,
    existingPaymentIntentId ? { ...paymentIntentOptions, existingPaymentIntentId } : paymentIntentOptions
  );
  const validationRunId = randomUUID();
  const operationKey = `demo-tenant:order-781:refund:${currency}:${amount}`;
  const adapter = new StripeRefundAdapter({
    stripe,
    paymentIntentId: paymentIntent.id,
    amount,
    currency
  });
  const store = new PostgresOperationStore(pool);
  const stripeNamespace = `${namespace}:stripe-validation:${validationRunId}`;

  const unsafeRefunds: Stripe.Refund[] = [];
  for (const frameworkToolCallId of ["call_A", "call_B"]) {
    unsafeRefunds.push(
      await stripe.refunds.create(
        {
          payment_intent: paymentIntent.id,
          amount,
          metadata: {
            validation_run_id: validationRunId,
            validation_path: "unsafe_ephemeral_identity",
            framework_tool_call_id: frameworkToolCallId,
            business_intent: "refund_order_781"
          }
        },
        {
          idempotencyKey: `unsafe:${validationRunId}:${frameworkToolCallId}`
        }
      )
    );
  }

  const baseOptions: Omit<WriteGuardExecutionOptions<Stripe.Refund>, "invocation"> = {
    key: operationKey,
    action: {
      name: "stripe.refund.create",
      provider: "stripe",
      effectType: "irreversible_write"
    },
    fingerprint: { paymentIntentId: paymentIntent.id, amount, currency },
    metadata: {
      paymentIntentId: paymentIntent.id,
      amount,
      currency,
      businessIntent: "refund_order_781",
      validationRunId
    },
    execute: (context) => adapter.execute(context.operationId),
    reconcile: (context) => adapter.reconcile(context.operationId),
    verify: (refund, context) => adapter.verify(refund, context.operationId),
    getProviderReference: (refund) => refund.id,
    getVerificationEvidence: (refund) => adapter.verificationEvidence(refund),
    faults: { throwAfterExternalSuccess: true }
  };

  try {
    await new WriteGuard({ store, namespace: stripeNamespace }).execute({
      ...baseOptions,
      invocation: { framework: "stripe-agent-validation", toolName: "refund_order", toolCallId: "call_A" }
    });
  } catch (error) {
    if (!(error instanceof UnknownExecutionOutcome)) throw error;
    line("First invocation", "UNKNOWN after Stripe created the refund");
  }
  const receipt = await new WriteGuard({ store, namespace: stripeNamespace }).execute({
    ...baseOptions,
    invocation: { framework: "stripe-agent-validation", toolName: "refund_order", toolCallId: "call_B" }
  });
  const guardedRefunds: Stripe.Refund[] = [];
  for await (const refund of stripe.refunds.list({ payment_intent: paymentIntent.id, limit: 100 })) {
    if (refund.metadata?.write_guard_operation_id === receipt.operationId) guardedRefunds.push(refund);
  }
  const timeline = await store.getTimeline(stripeNamespace, operationKey);
  if (!timeline) throw new Error("Stripe operation timeline was not persisted");
  renderTimeline(timeline);
  console.log("\nStripe test-mode evidence");
  console.log(JSON.stringify({
    validationRunId,
    paymentIntent: {
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      livemode: paymentIntent.livemode
    },
    unsafePath: {
      frameworkToolCallIds: ["call_A", "call_B"],
      providerIdempotencyDerivedFrom: "ephemeral framework call ID",
      refundCount: unsafeRefunds.length,
      totalRefunded: unsafeRefunds.reduce((total, refund) => total + refund.amount, 0),
      refunds: unsafeRefunds.map((refund) => ({ id: refund.id, amount: refund.amount, status: refund.status }))
    },
    guardedPath: {
      frameworkToolCallIds: ["call_A", "call_B"],
      stableOperationKey: operationKey,
      refundCount: guardedRefunds.length,
      refunds: guardedRefunds.map((refund) => ({
        id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        writeGuardOperationId: refund.metadata?.write_guard_operation_id
      })),
      receipt
    }
  }, null, 2));
  if (unsafeRefunds.length !== 2) throw new Error(`Expected two unsafe Stripe refunds, found ${unsafeRefunds.length}`);
  if (guardedRefunds.length !== 1) {
    throw new Error(`Expected exactly one guarded Stripe refund, found ${guardedRefunds.length}`);
  }
  if (!unsafeRefunds.every((refund) => refund.amount === amount)) {
    throw new Error("Unsafe Stripe refund amounts did not match the requested partial refund");
  }
}

async function inspect(pool: pg.Pool): Promise<void> {
  const operationKey = arg("key") ?? process.argv[3];
  if (!operationKey) throw new Error("Use: pnpm inspect -- --key=<operation-key>");
  const store = new PostgresOperationStore(pool);
  const timeline = await store.getTimeline(namespace, operationKey);
  if (!timeline) throw new Error(`No operation found for ${namespace}:${operationKey}`);
  renderTimeline(timeline);
}

const command = process.argv[2] ?? "fake";
const pool = new Pool({ connectionString: databaseUrl });

try {
  if (command === "ordinary") await runOrdinaryRetry(pool);
  else if (command === "fake") await runFakeDemo(pool);
  else if (command === "stripe") await runStripeDemo(pool);
  else if (command === "inspect") await inspect(pool);
  else throw new Error(`Unknown command ${command}`);
} finally {
  await pool.end();
}
