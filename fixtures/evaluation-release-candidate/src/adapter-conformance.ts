import {
  ConfirmedExecutionFailure,
  type ReconciliationOutcome
} from "@closure/writeguard";
import {
  defineAdapterContractTests,
  type AdapterContractScenario
} from "@closure/writeguard/testing";

type Result = {
  id: string;
  operationId: string;
  status: "succeeded";
};

const contract = defineAdapterContractTests<Result>({
  name: "simulated-refund-adapter",
  provider: {
    id: "simulated-refund-adapter",
    version: "1.0.0",
    environment: "simulated"
  },
  async createHarness(scenario: AdapterContractScenario) {
    const effects: Result[] = [];
    return {
      key: `adapter-contract:${scenario}`,
      fingerprint: { scenario, amount: 2500, currency: "usd" },
      async execute(context) {
        if (scenario === "confirmed_failure") {
          throw new ConfirmedExecutionFailure("simulated provider rejection");
        }
        const result: Result = {
          id: `result-${effects.length + 1}`,
          operationId: context.operationId,
          status: "succeeded"
        };
        effects.push(result);
        if (scenario === "ambiguous_matches") {
          effects.push({ ...result, id: "result-2" });
        }
        if (
          scenario === "timeout_after_success" ||
          scenario === "reconciliation_unavailable" ||
          scenario === "ambiguous_matches"
        ) {
          throw new Error("simulated acknowledgement loss");
        }
        return result;
      },
      async reconcile(context): Promise<ReconciliationOutcome<Result>> {
        if (scenario === "reconciliation_unavailable") {
          return {
            kind: "unavailable",
            reason: "simulated lookup unavailable",
            evidence: { environment: "simulated" }
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

const receipt = await contract.runReceipt();
if (receipt.overallResult !== "passed") {
  throw new Error("The simulated adapter did not pass all six public conformance scenarios.");
}
console.log(JSON.stringify(receipt));
