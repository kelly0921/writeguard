import { describe, expect, it } from "vitest";
import { ConfirmedExecutionFailure, type ReconciliationOutcome } from "@closure/writeguard";
import {
  adapterContractScenarios,
  digestAdapterConformanceReceipt,
  defineAdapterContractTests,
  parseAdapterConformanceReceipt,
  type AdapterConformanceProvider,
  type AdapterContractScenario
} from "@closure/writeguard/testing";

type Result = { id: string; operationId: string; status: "succeeded" };

function contract(options: {
  provider?: AdapterConformanceProvider;
  unsupported?: AdapterContractScenario;
  exposeSecretInFailure?: boolean;
  failScenario?: AdapterContractScenario;
} = {}) {
  return defineAdapterContractTests<Result>({
    name: "conformance-fake-payments",
    ...(options.provider ? { provider: options.provider } : {}),
    async createHarness(scenario: AdapterContractScenario) {
      if (scenario === options.unsupported) {
        return { unsupported: true, reason: "Provider lookup is not available in this environment." };
      }
      const effects: Result[] = [];
      return {
        key: `adapter-contract:${scenario}`,
        fingerprint: { scenario, amount: 100, currency: "usd" },
        async execute(context) {
          if (scenario === options.failScenario) {
            throw new Error("raw-provider-secret-shaped-value");
          }
          if (scenario === "confirmed_failure") {
            throw new ConfirmedExecutionFailure(
              options.exposeSecretInFailure
                ? "provider rejected secret-shaped-value"
                : "provider rejected the request"
            );
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
}

describe("adapter conformance kit", () => {
  it("validates the required execution and reconciliation scenarios", async () => {
    const results = await contract().run();
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it("emits a deterministic runtime-validated simulated receipt", async () => {
    const first = await contract().runReceipt();
    const second = await contract().runReceipt();
    expect(parseAdapterConformanceReceipt(first)).toEqual(first);
    expect(first.provider.environment).toBe("simulated");
    expect(first.overallResult).toBe("passed");
    expect(first.scenarios.map((scenario) => scenario.scenario)).toEqual(adapterContractScenarios);
    expect(digestAdapterConformanceReceipt(first)).toBe(digestAdapterConformanceReceipt(second));
  });

  it("preserves an explicit unsupported scenario instead of inventing a pass", async () => {
    const receipt = await contract({ unsupported: "reconciliation_unavailable" }).runReceipt();
    expect(receipt.overallResult).toBe("passed_with_unsupported");
    expect(receipt.scenarios).toContainEqual(expect.objectContaining({
      scenario: "reconciliation_unavailable",
      status: "unsupported"
    }));
    expect(receipt.limitations.join(" ")).toContain("Unsupported scenarios remain unverified");
  });

  it("labels test-mode evidence without inferring production conformance", async () => {
    const testMode = await contract({
      provider: {
        id: "provider-test-adapter",
        version: "1.2.3",
        environment: "test_mode"
      }
    }).runReceipt();
    expect(testMode.provider.environment).toBe("test_mode");
    expect(JSON.stringify(testMode)).not.toContain('"environment":"production"');

    const explicitlyProduction = await contract({
      provider: {
        id: "provider-production-adapter",
        version: "1.2.3",
        environment: "production"
      }
    }).runReceipt();
    expect(explicitlyProduction.provider.environment).toBe("production");
  });

  it("does not copy raw provider errors into conformance receipts", async () => {
    const receipt = await contract({
      exposeSecretInFailure: true,
      failScenario: "success"
    }).runReceipt();
    expect(receipt.overallResult).toBe("failed");
    expect(receipt.scenarios).toContainEqual(expect.objectContaining({
      scenario: "success",
      status: "failed"
    }));
    expect(JSON.stringify(receipt)).not.toContain("secret-shaped-value");
  });
});
