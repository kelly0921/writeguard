import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRequestFingerprint,
  PostgresFakeRefundProvider,
  PostgresOperationStore,
  ReconciliationFailure,
  UnknownExecutionOutcome,
  type FakeRefund
} from "@writeguard/core";
import { WriteGuard, type WriteGuardExecutionOptions } from "@writeguard/sdk";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const { Pool } = pg;

function postgresRefundOptions(
  provider: PostgresFakeRefundProvider,
  key: string,
  paymentIntentId: string,
  overrides: Partial<WriteGuardExecutionOptions<FakeRefund>> = {}
): WriteGuardExecutionOptions<FakeRefund> {
  return {
    key,
    action: { name: "refund.create", provider: "fake-payments", effectType: "reversible_write" },
    fingerprint: { paymentIntentId, amount: 500, currency: "usd" },
    execute: (context) =>
      provider.createRefund({
        operationId: context.operationId,
        paymentIntentId,
        amount: 500,
        currency: "usd"
      }),
    reconcile: (context) => provider.reconcile(context.operationId, paymentIntentId),
    verify: async (refund, context) => refund.operationId === context.operationId,
    getProviderReference: (refund) => refund.id,
    ...overrides
  };
}

integration("PostgreSQL operation ledger", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    for (const migration of [
      "0000_initial",
      "0001_ordered_events",
      "0002_support_cases",
      "0003_support_case_cardinality",
      "0004_shadow_observations",
      "0005_fake_provider_test_schema"
    ]) {
      const sql = await readFile(
        new URL(`../packages/core/drizzle/${migration}.sql`, import.meta.url),
        "utf8"
      );
      await pool.query(sql);
    }
    await pool.query(
      "TRUNCATE writeguard_shadow_invocations, writeguard_shadow_observations, support_cases, writeguard_execution_receipts, writeguard_operation_events, writeguard_operation_attempts, writeguard_operations, fake_provider_refunds CASCADE"
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("serializes competing workers and recovers a lost acknowledgement without a duplicate refund", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool);
    const key = "postgres:refund:pi_integration:500";
    const makeOptions = (injectFault: boolean): WriteGuardExecutionOptions<FakeRefund> =>
      postgresRefundOptions(provider, key, "pi_integration", injectFault ? {
        faults: { throwAfterExternalSuccess: true }
      } : {});
    const firstWorker = new WriteGuard({ store, namespace: "integration", pollIntervalMs: 2 });
    const secondWorker = new WriteGuard({ store, namespace: "integration", pollIntervalMs: 2 });

    await expect(firstWorker.execute(makeOptions(true))).rejects.toBeInstanceOf(UnknownExecutionOutcome);
    const [firstReceipt, repeatedReceipt] = await Promise.all([
      firstWorker.execute(makeOptions(false)),
      secondWorker.execute(makeOptions(false))
    ]);

    expect(firstReceipt.id).toBe(repeatedReceipt.id);
    expect(firstReceipt).toMatchObject({ status: "CONFIRMED", duplicateExecutionPrevented: true });
    expect(await provider.countRefunds("pi_integration")).toBe(1);
  });

  it("deduplicates two live workers racing on the same key", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool);
    const options = postgresRefundOptions(
      provider,
      "postgres:concurrent:refund",
      "pi_concurrent",
      {
        execute: async (context) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return provider.createRefund({
            operationId: context.operationId,
            paymentIntentId: "pi_concurrent",
            amount: 500,
            currency: "usd"
          });
        }
      }
    );
    const workers = [
      new WriteGuard({ store, namespace: "integration-concurrent", pollIntervalMs: 2 }),
      new WriteGuard({ store, namespace: "integration-concurrent", pollIntervalMs: 2 })
    ];

    const receipts = await Promise.all(workers.map((worker) => worker.execute(options)));
    expect(receipts).toHaveLength(2);
    expect(receipts[0]!.id).toBe(receipts[1]!.id);
    expect(await provider.countRefunds("pi_concurrent")).toBe(1);
  });

  it("safely reclaims a stale pre-submission claim", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool);
    const options = postgresRefundOptions(provider, "postgres:stale:claim", "pi_stale");
    await store.claim({
      namespace: "integration-stale",
      operationKey: options.key,
      action: { name: "refund.create", provider: "fake-payments", effectType: "reversible_write" },
      requestFingerprint: createRequestFingerprint({
        action: options.action,
        materialInput: options.fingerprint
      }),
      metadata: {},
      workerId: "worker-that-crashed-before-submission",
      claimTtlMs: 1
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const receipt = await new WriteGuard({ store, namespace: "integration-stale" }).execute(options);
    expect(receipt.status).toBe("CONFIRMED");
    expect(await provider.countRefunds("pi_stale")).toBe(1);
    const timeline = await store.getTimeline("integration-stale", options.key);
    expect(timeline?.events.some((event) => event.eventType === "STALE_CLAIM_RECLAIMED")).toBe(true);
  });

  it("reconciles instead of re-executing after a worker dies in SUBMITTED", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool);
    const options = postgresRefundOptions(provider, "postgres:stale:submitted", "pi_stale_submitted");
    const workerId = "worker-that-died-after-provider-success";
    const decision = await store.claim({
      namespace: "integration-stale-submitted",
      operationKey: options.key,
      action: { name: "refund.create", provider: "fake-payments", effectType: "reversible_write" },
      requestFingerprint: createRequestFingerprint({
        action: options.action,
        materialInput: options.fingerprint
      }),
      metadata: {},
      workerId,
      claimTtlMs: 1
    });
    if (decision.kind !== "execute") throw new Error(`Expected execute claim, received ${decision.kind}`);
    await store.markSubmitted(decision.operation.id, workerId);
    await provider.createRefund({
      operationId: decision.operation.id,
      paymentIntentId: "pi_stale_submitted",
      amount: 500,
      currency: "usd"
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const receipt = await new WriteGuard({
      store,
      namespace: "integration-stale-submitted"
    }).execute(options);
    expect(receipt).toMatchObject({ status: "CONFIRMED", duplicateExecutionPrevented: true });
    expect(await provider.countRefunds("pi_stale_submitted")).toBe(1);
    const timeline = await store.getTimeline("integration-stale-submitted", options.key);
    expect(
      timeline?.events.some((event) => event.eventType === "STALE_SUBMISSION_BECAME_UNKNOWN")
    ).toBe(true);
  });

  it("persists a stable receipt for a provider-confirmed failure", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool, { scenario: "confirmed_failure" });
    const options = postgresRefundOptions(provider, "postgres:confirmed:failure", "pi_failure");
    const guard = new WriteGuard({ store, namespace: "integration-failure" });

    const first = await guard.execute(options);
    const repeated = await guard.execute(options);
    expect(first).toMatchObject({ status: "FAILED", resolution: "provider_confirmed_failure" });
    expect(repeated.id).toBe(first.id);
  });

  it("persists NEEDS_REVIEW when reconciliation finds conflicting effects", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool, { scenario: "conflicting_results" });
    const options = postgresRefundOptions(provider, "postgres:ambiguous", "pi_ambiguous", {
      faults: { throwAfterExternalSuccess: true }
    });
    const guard = new WriteGuard({ store, namespace: "integration-ambiguous" });

    await expect(guard.execute(options)).rejects.toBeInstanceOf(UnknownExecutionOutcome);
    const receipt = await guard.execute(options);
    expect(receipt.status).toBe("NEEDS_REVIEW");
    expect(receipt.unresolvedEffects).toHaveLength(2);
  });

  it("keeps UNKNOWN safe while PostgreSQL-backed reconciliation is temporarily unavailable", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool, {
      scenario: "delayed_reconciliation",
      reconciliationDelayMs: 500
    });
    const options = postgresRefundOptions(provider, "postgres:delayed-reconciliation", "pi_delayed_pg", {
      faults: { throwAfterExternalSuccess: true }
    });
    const guard = new WriteGuard({ store, namespace: "integration-delayed" });

    await expect(guard.execute(options)).rejects.toBeInstanceOf(UnknownExecutionOutcome);
    await expect(guard.execute(options)).rejects.toBeInstanceOf(ReconciliationFailure);
    expect((await store.getTimeline("integration-delayed", options.key))?.operation.status).toBe("UNKNOWN");
    expect(await provider.countRefunds("pi_delayed_pg")).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 525));
    const receipt = await guard.execute(options);
    expect(receipt.status).toBe("CONFIRMED");
    expect(await provider.countRefunds("pi_delayed_pg")).toBe(1);
  });

  it("persists compensation outcome after verification fails", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool);
    const compensate = vi.fn(async () => undefined);
    const options = postgresRefundOptions(provider, "postgres:compensation", "pi_compensate", {
      verify: async () => false,
      compensate
    });

    const receipt = await new WriteGuard({ store, namespace: "integration-compensation" }).execute(options);
    expect(receipt.status).toBe("COMPENSATED");
    expect(compensate).toHaveBeenCalledOnce();
  });
});
