import { describe, expect, it, vi } from "vitest";
import { InMemoryOperationStore } from "@writeguard/core";
import { WriteGuard } from "@writeguard/sdk";

describe("shadow mode", () => {
  it("persists stable identity and repeated invocations without initiating or suppressing a write", async () => {
    const store = new InMemoryOperationStore();
    const guard = new WriteGuard({ store, namespace: "shadow-unit" });
    const reconcile = vi.fn(async () => ({
      kind: "found" as const,
      result: { id: "refund_1", status: "succeeded" as const },
      evidence: { matchCount: 1, unrestrictedProviderPayload: "not persisted" }
    }));
    const options = {
      key: "tenant:order:refund:usd:100",
      action: { name: "refund_order", provider: "fake-payments" },
      fingerprint: { tenantId: "tenant", orderId: "order", amount: 100, currency: "usd" },
      metadata: { tenantId: "tenant", apiKey: "must-not-persist" },
      reconcile,
      verify: async (result: { status: string }) => result.status === "succeeded",
      getProviderReference: (result: { id: string }) => result.id
    };

    const first = await guard.observe({
      ...options,
      reportedInvocation: { framework: "mcp", toolName: "refund_order", toolCallId: "call_A" }
    });
    const second = await guard.observe({
      ...options,
      reportedInvocation: { framework: "mcp", toolName: "refund_order", toolCallId: "call_B" }
    });

    expect(first).toMatchObject({
      mode: "shadow",
      observational: true,
      invocationCount: 1,
      duplicateInvocationObserved: false,
      wouldSuppressDuplicate: false,
      classification: "verified_external_effect"
    });
    expect(second).toMatchObject({
      invocationCount: 2,
      duplicateInvocationObserved: true,
      wouldSuppressDuplicate: true,
      verified: true,
      providerReference: "refund_1"
    });
    expect(reconcile).toHaveBeenCalledTimes(2);
    const persisted = await store.getShadowObservation("shadow-unit", options.key);
    expect(persisted).toMatchObject({
      invocationCount: 2,
      reconciliationAttemptCount: 2,
      latestClassification: "verified_external_effect",
      metadata: { tenantId: "tenant", apiKey: "[REDACTED]" }
    });
  });

  it("classifies ambiguous and unavailable reconciliation without becoming enforcing", async () => {
    const store = new InMemoryOperationStore();
    const guard = new WriteGuard({ store, namespace: "shadow-classification" });
    const base = {
      action: { name: "refund_order", provider: "fake-payments" },
      fingerprint: { amount: 100 }
    };
    const ambiguous = await guard.observe({
      ...base,
      key: "shadow:ambiguous",
      reconcile: async () => ({
        kind: "ambiguous" as const,
        providerReferences: ["refund_1", "refund_2"],
        evidence: { matchCount: 2 }
      })
    });
    const unavailable = await guard.observe({
      ...base,
      key: "shadow:unavailable",
      reconcile: async () => {
        throw new Error("provider read unavailable");
      }
    });

    expect(ambiguous).toMatchObject({
      mode: "shadow",
      classification: "ambiguous_matches",
      reconciliationOutcome: "ambiguous",
      providerReference: null
    });
    expect(unavailable).toMatchObject({
      mode: "shadow",
      classification: "reconciliation_unavailable",
      reconciliationOutcome: "unavailable"
    });
  });
});
