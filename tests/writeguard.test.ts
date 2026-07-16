import { describe, expect, it, vi } from "vitest";
import {
  InMemoryFakeRefundProvider,
  InMemoryOperationStore,
  OperationKeyConflictError,
  ReconciliationFailure,
  UnknownExecutionOutcome,
  type FakeRefund,
  type FakeRefundProviderContract
} from "@writeguard/core";
import { WriteGuard, type WriteGuardExecutionOptions } from "@writeguard/sdk";

const namespace = "unit-tests";
const paymentIntentId = "pi_writeguard_test";

function refundOptions(
  provider: FakeRefundProviderContract,
  overrides: Partial<WriteGuardExecutionOptions<FakeRefund>> = {}
): WriteGuardExecutionOptions<FakeRefund> {
  return {
    key: `refund:${paymentIntentId}:500`,
    action: {
      name: "refund.create",
      provider: "fake-payments",
      effectType: "reversible_write"
    },
    fingerprint: { paymentIntentId, amount: 500, currency: "usd" },
    metadata: { paymentIntentId, amount: 500, currency: "usd", apiKey: "never-store-me" },
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
      refund.metadata.write_guard_operation_id === context.operationId,
    getProviderReference: (refund) => refund.id,
    getVerificationEvidence: (refund) => ({ refundId: refund.id, status: refund.status }),
    ...overrides
  };
}

describe("WriteGuard", () => {
  it("reconciles a committed effect after the acknowledgement is lost", async () => {
    const store = new InMemoryOperationStore();
    const provider = new InMemoryFakeRefundProvider();
    const guard = new WriteGuard({ store, namespace });
    const options = refundOptions(provider, { faults: { throwAfterExternalSuccess: true } });

    await expect(guard.execute(options)).rejects.toBeInstanceOf(UnknownExecutionOutcome);
    const receipt = await guard.execute(options);

    expect(receipt).toMatchObject({
      status: "CONFIRMED",
      verified: true,
      attempts: 2,
      resolution: "reconciled_after_unknown_outcome",
      duplicateExecutionPrevented: true
    });
    expect(await provider.countRefunds(paymentIntentId)).toBe(1);
    const timeline = await store.getTimeline(namespace, options.key);
    expect(timeline?.events.map((event) => event.newStatus)).toEqual([
      "PLANNED",
      "CLAIMED",
      "SUBMITTED",
      "UNKNOWN",
      "RECONCILING",
      "CONFIRMED"
    ]);
    expect(timeline?.operation.metadata.apiKey).toBe("[REDACTED]");
  });

  it("collapses concurrent calls with the same operation key into one external effect", async () => {
    const store = new InMemoryOperationStore();
    const provider = new InMemoryFakeRefundProvider();
    const guard = new WriteGuard({ store, namespace, pollIntervalMs: 1 });
    const options = refundOptions(provider);

    const [first, second] = await Promise.all([guard.execute(options), guard.execute(options)]);

    expect(first.id).toBe(second.id);
    expect(first.status).toBe("CONFIRMED");
    expect(await provider.countRefunds(paymentIntentId)).toBe(1);
  });

  it("refuses to reuse an operation key for different material input", async () => {
    const store = new InMemoryOperationStore();
    const provider = new InMemoryFakeRefundProvider();
    const guard = new WriteGuard({ store, namespace });
    const options = refundOptions(provider);
    await guard.execute(options);

    await expect(
      guard.execute({ ...options, fingerprint: { paymentIntentId, amount: 900, currency: "usd" } })
    ).rejects.toBeInstanceOf(OperationKeyConflictError);
    expect(await provider.countRefunds(paymentIntentId)).toBe(1);
  });

  it("returns a stable FAILED receipt for an explicit provider rejection", async () => {
    const store = new InMemoryOperationStore();
    const provider = new InMemoryFakeRefundProvider({ scenario: "confirmed_failure" });
    const guard = new WriteGuard({ store, namespace });
    const options = refundOptions(provider);

    const first = await guard.execute(options);
    const repeated = await guard.execute(options);

    expect(first).toMatchObject({ status: "FAILED", resolution: "provider_confirmed_failure" });
    expect(repeated.id).toBe(first.id);
    expect(await provider.countRefunds(paymentIntentId)).toBe(0);
  });

  it("escalates multiple matching effects instead of guessing which result is authoritative", async () => {
    const store = new InMemoryOperationStore();
    const provider = new InMemoryFakeRefundProvider({ scenario: "conflicting_results" });
    const guard = new WriteGuard({ store, namespace });
    const options = refundOptions(provider, { faults: { throwAfterExternalSuccess: true } });

    await expect(guard.execute(options)).rejects.toBeInstanceOf(UnknownExecutionOutcome);
    const receipt = await guard.execute(options);

    expect(receipt.status).toBe("NEEDS_REVIEW");
    expect(receipt.resolution).toBe("reconciliation_found_multiple_matching_external_effects");
    expect(receipt.unresolvedEffects).toHaveLength(2);
    expect(await provider.countRefunds(paymentIntentId)).toBe(2);
  });

  it("keeps the operation UNKNOWN while provider reconciliation is temporarily unavailable", async () => {
    const store = new InMemoryOperationStore();
    const provider = new InMemoryFakeRefundProvider({
      scenario: "delayed_reconciliation",
      reconciliationDelayMs: 25
    });
    const guard = new WriteGuard({ store, namespace });
    const options = refundOptions(provider, { faults: { throwAfterExternalSuccess: true } });

    await expect(guard.execute(options)).rejects.toBeInstanceOf(UnknownExecutionOutcome);
    await expect(guard.execute(options)).rejects.toBeInstanceOf(ReconciliationFailure);
    expect((await store.getTimeline(namespace, options.key))?.operation.status).toBe("UNKNOWN");

    await new Promise((resolve) => setTimeout(resolve, 30));
    const receipt = await guard.execute(options);
    expect(receipt.status).toBe("CONFIRMED");
    expect(await provider.countRefunds(paymentIntentId)).toBe(1);
  });

  it("records a conservative review requirement when absence cannot prove non-submission", async () => {
    const store = new InMemoryOperationStore();
    const provider = new InMemoryFakeRefundProvider();
    const guard = new WriteGuard({ store, namespace });
    const options = refundOptions(provider, {
      execute: async () => {
        throw new UnknownExecutionOutcome("transport broke after request dispatch");
      }
    });

    await expect(guard.execute(options)).rejects.toBeInstanceOf(UnknownExecutionOutcome);
    const receipt = await guard.execute(options);
    expect(receipt).toMatchObject({
      status: "NEEDS_REVIEW",
      resolution: "reconciliation_found_no_matching_external_effect"
    });
    expect(receipt.unresolvedEffects[0]?.type).toBe("unknown_external_effect");
  });

  it("compensates a known effect when postcondition verification fails", async () => {
    const store = new InMemoryOperationStore();
    const provider = new InMemoryFakeRefundProvider();
    const compensate = vi.fn(async () => undefined);
    const guard = new WriteGuard({ store, namespace });
    const options = refundOptions(provider, { verify: async () => false, compensate });

    const receipt = await guard.execute(options);

    expect(receipt).toMatchObject({
      status: "COMPENSATED",
      resolution: "compensated_after_verification_failure"
    });
    expect(compensate).toHaveBeenCalledOnce();
  });
});
