import {
  ConfirmedExecutionFailure,
  ReconciliationFailure,
  UnknownExecutionOutcome,
  createUnsafeInMemoryStorage,
  createWriteGuard,
  type ExecutionContext,
  type ReconciliationOutcome,
  type VerificationContext
} from "./index.js";

export const adapterContractScenarios = [
  "success",
  "confirmed_failure",
  "timeout_after_success",
  "duplicate_invocation",
  "reconciliation_unavailable",
  "ambiguous_matches"
] as const;

export type AdapterContractScenario = (typeof adapterContractScenarios)[number];

export type AdapterContractHarness<TResult> = {
  key: string;
  fingerprint: unknown;
  execute(context: ExecutionContext): Promise<TResult>;
  reconcile(context: ExecutionContext): Promise<ReconciliationOutcome<TResult>>;
  verify(result: TResult, context: VerificationContext): Promise<boolean>;
  getProviderReference?(result: TResult): string | null;
  countExternalEffects(): Promise<number>;
};

export type AdapterContractDefinition<TResult> = {
  name: string;
  createHarness(scenario: AdapterContractScenario): Promise<AdapterContractHarness<TResult>>;
};

export type AdapterContractResult = {
  scenario: AdapterContractScenario;
  passed: boolean;
  detail: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runScenario<TResult>(
  definition: AdapterContractDefinition<TResult>,
  scenario: AdapterContractScenario
): Promise<AdapterContractResult> {
  const harness = await definition.createHarness(scenario);
  const storage = createUnsafeInMemoryStorage();
  const writeGuard = createWriteGuard({
    storage,
    namespace: `adapter-contract:${definition.name}:${scenario}`,
    claimTtlMs: 5,
    waitTimeoutMs: 250,
    pollIntervalMs: 1
  });
  const options = {
    key: harness.key,
    action: {
      name: `${definition.name}.contract_action`,
      provider: definition.name,
      effectType: "conditionally_reversible" as const
    },
    fingerprint: harness.fingerprint,
    execute: (context: ExecutionContext) => harness.execute(context),
    reconcile: (context: ExecutionContext) => harness.reconcile(context),
    verify: (result: TResult, context: VerificationContext) => harness.verify(result, context),
    ...(harness.getProviderReference
      ? { getProviderReference: (result: TResult) => harness.getProviderReference!(result) }
      : {})
  };

  try {
    if (scenario === "confirmed_failure") {
      const receipt = await writeGuard.execute(options);
      assert(receipt.status === "FAILED", "confirmed provider failure must produce a FAILED receipt");
      assert(await harness.countExternalEffects() === 0, "confirmed failure must not create an effect");
    } else if (scenario === "timeout_after_success") {
      try {
        await writeGuard.execute(options);
        throw new Error("timeout-after-success must expose UNKNOWN on the first call");
      } catch (error) {
        assert(
          error instanceof UnknownExecutionOutcome,
          "timeout-after-success must throw UnknownExecutionOutcome"
        );
      }
      const receipt = await writeGuard.execute(options);
      assert(receipt.status === "CONFIRMED", "reconciliation must confirm the committed effect");
      assert(receipt.duplicateExecutionPrevented, "reconciliation must report duplicate prevention");
      assert(await harness.countExternalEffects() === 1, "reconciliation must not create a second effect");
    } else if (scenario === "duplicate_invocation") {
      const first = await writeGuard.execute(options);
      const repeated = await writeGuard.execute(options);
      assert(first.id === repeated.id, "duplicate invocation must receive the same receipt");
      assert(await harness.countExternalEffects() === 1, "duplicate invocation must create one effect");
    } else if (scenario === "reconciliation_unavailable") {
      try {
        await writeGuard.execute(options);
        throw new Error("reconciliation-unavailable setup must expose UNKNOWN first");
      } catch (error) {
        assert(error instanceof UnknownExecutionOutcome, "first call must be UNKNOWN");
      }
      try {
        await writeGuard.execute(options);
        throw new Error("unavailable reconciliation must not return a terminal receipt");
      } catch (error) {
        assert(error instanceof ReconciliationFailure, "unavailable reconciliation must remain safe");
      }
      assert(await harness.countExternalEffects() === 1, "unavailable reconciliation must not retry the write");
    } else if (scenario === "ambiguous_matches") {
      try {
        await writeGuard.execute(options);
        throw new Error("ambiguous setup must expose UNKNOWN first");
      } catch (error) {
        assert(error instanceof UnknownExecutionOutcome, "first call must be UNKNOWN");
      }
      const receipt = await writeGuard.execute(options);
      assert(receipt.status === "NEEDS_REVIEW", "ambiguous matches must require review");
      assert(receipt.unresolvedEffects.length > 1, "ambiguous matches must preserve candidate references");
    } else {
      const receipt = await writeGuard.execute(options);
      assert(receipt.status === "CONFIRMED", "success must produce a CONFIRMED receipt");
      assert(await harness.countExternalEffects() === 1, "success must create one effect");
    }
    return { scenario, passed: true, detail: "contract satisfied" };
  } finally {
    await storage.close();
  }
}

export function defineAdapterContractTests<TResult>(definition: AdapterContractDefinition<TResult>) {
  return {
    async run(): Promise<AdapterContractResult[]> {
      const results: AdapterContractResult[] = [];
      for (const scenario of adapterContractScenarios) {
        try {
          results.push(await runScenario(definition, scenario));
        } catch (error) {
          results.push({
            scenario,
            passed: false,
            detail: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return results;
    }
  };
}

export { ConfirmedExecutionFailure };
