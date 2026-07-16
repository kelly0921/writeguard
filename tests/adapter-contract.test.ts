import { describe, expect, it } from "vitest";
import { ConfirmedExecutionFailure, type ReconciliationOutcome } from "@closure/writeguard";
import {
  defineAdapterContractTests,
  type AdapterContractScenario
} from "@closure/writeguard/testing";

type Result = { id: string; operationId: string; status: "succeeded" };

describe("adapter conformance kit", () => {
  it("validates the required execution and reconciliation scenarios", async () => {
    const contract = defineAdapterContractTests<Result>({
      name: "conformance-fake-payments",
      async createHarness(scenario: AdapterContractScenario) {
        const effects: Result[] = [];
        return {
          key: `adapter-contract:${scenario}`,
          fingerprint: { scenario, amount: 100, currency: "usd" },
          async execute(context) {
            if (scenario === "confirmed_failure") {
              throw new ConfirmedExecutionFailure("provider rejected the request");
            }
            const result: Result = {
              id: `result_${effects.length + 1}`,
              operationId: context.operationId,
              status: "succeeded"
            };
            effects.push(result);
            if (scenario === "ambiguous_matches") {
              effects.push({ ...result, id: "result_2" });
            }
            if (
              scenario === "timeout_after_success" ||
              scenario === "reconciliation_unavailable" ||
              scenario === "ambiguous_matches"
            ) {
              throw new Error("provider acknowledgement lost after commit");
            }
            return result;
          },
          async reconcile(context): Promise<ReconciliationOutcome<Result>> {
            if (scenario === "reconciliation_unavailable") {
              return {
                kind: "unavailable",
                reason: "provider lookup unavailable",
                evidence: {}
              };
            }
            const matches = effects.filter((effect) => effect.operationId === context.operationId);
            if (matches.length > 1) {
              return {
                kind: "ambiguous",
                providerReferences: matches.map((effect) => effect.id),
                evidence: { matchCount: matches.length }
              };
            }
            if (matches.length === 0) {
              return { kind: "not_found", evidence: { matchCount: 0 } };
            }
            return {
              kind: "found",
              result: matches[0]!,
              evidence: { matchCount: 1 }
            };
          },
          async verify(result, context) {
            return result.status === "succeeded" && result.operationId === context.operationId;
          },
          getProviderReference: (result) => result.id,
          async countExternalEffects() {
            return effects.length;
          }
        };
      }
    });

    const results = await contract.run();
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.passed)).toBe(true);
  });
});
