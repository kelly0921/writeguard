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
import { digestAnalysisArtifact } from "./analysis/index.js";
import { z } from "zod";

export const adapterContractScenarios = [
  "success",
  "confirmed_failure",
  "timeout_after_success",
  "duplicate_invocation",
  "reconciliation_unavailable",
  "ambiguous_matches"
] as const;

export const ADAPTER_CONFORMANCE_CONTRACT_VERSION = "writeguard.adapter-conformance/v1" as const;

export const adapterConformanceEnvironments = [
  "simulated",
  "test_mode",
  "production"
] as const;

export type AdapterContractScenario = (typeof adapterContractScenarios)[number];

export const adapterConformanceProviderSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(100),
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/).max(100).optional(),
  environment: z.enum(adapterConformanceEnvironments)
}).strict();

export const adapterConformanceScenarioResultSchema = z.object({
  scenario: z.enum(adapterContractScenarios),
  status: z.enum(["passed", "failed", "unsupported"]),
  summary: z.string().min(1).max(300)
}).strict();

export const adapterConformanceReceiptSchema = z.object({
  schemaVersion: z.literal(ADAPTER_CONFORMANCE_CONTRACT_VERSION),
  kind: z.literal("writeguard_adapter_conformance_receipt"),
  provider: adapterConformanceProviderSchema,
  overallResult: z.enum(["passed", "failed", "passed_with_unsupported"]),
  scenarios: z.array(adapterConformanceScenarioResultSchema).length(adapterContractScenarios.length),
  verifiedGuarantees: z.array(z.string().min(1).max(300)).max(20),
  limitations: z.array(z.string().min(1).max(300)).min(1).max(20)
}).strict();

export type AdapterConformanceEnvironment = z.infer<
  typeof adapterConformanceProviderSchema
>["environment"];
export type AdapterConformanceProvider = z.infer<typeof adapterConformanceProviderSchema>;
export type AdapterConformanceScenarioResult = z.infer<typeof adapterConformanceScenarioResultSchema>;
export type AdapterConformanceReceipt = z.infer<typeof adapterConformanceReceiptSchema>;

export type AdapterContractHarness<TResult> = {
  key: string;
  fingerprint: unknown;
  execute(context: ExecutionContext): Promise<TResult>;
  reconcile(context: ExecutionContext): Promise<ReconciliationOutcome<TResult>>;
  verify(result: TResult, context: VerificationContext): Promise<boolean>;
  getProviderReference?(result: TResult): string | null;
  countExternalEffects(): Promise<number>;
};

export type AdapterContractUnsupported = {
  unsupported: true;
  reason: string;
};

export type AdapterContractDefinition<TResult> = {
  name: string;
  provider?: AdapterConformanceProvider;
  createHarness(
    scenario: AdapterContractScenario
  ): Promise<AdapterContractHarness<TResult> | AdapterContractUnsupported>;
};

export type AdapterContractResult = {
  scenario: AdapterContractScenario;
  passed: boolean;
  detail: string;
  status?: "passed" | "failed" | "unsupported";
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isUnsupportedHarness<TResult>(
  harness: AdapterContractHarness<TResult> | AdapterContractUnsupported
): harness is AdapterContractUnsupported {
  return "unsupported" in harness && harness.unsupported === true;
}

async function runScenario<TResult>(
  definition: AdapterContractDefinition<TResult>,
  scenario: AdapterContractScenario
): Promise<AdapterContractResult> {
  const harness = await definition.createHarness(scenario);
  if (isUnsupportedHarness(harness)) {
    return {
      scenario,
      passed: false,
      detail: `unsupported: ${harness.reason}`,
      status: "unsupported"
    };
  }
  const storage = createUnsafeInMemoryStorage();
  const writeGuard = createWriteGuard({
    storage,
    namespace: `adapter-contract:${definition.name}:${scenario}`,
    claimTtlMs: 30_000,
    waitTimeoutMs: 5_000,
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
    return { scenario, passed: true, detail: "contract satisfied", status: "passed" };
  } finally {
    await storage.close();
  }
}

function providerFor<TResult>(
  definition: AdapterContractDefinition<TResult>
): AdapterConformanceProvider {
  return adapterConformanceProviderSchema.parse(
    definition.provider ?? {
      id: definition.name,
      environment: "simulated"
    }
  );
}

function toReceiptResult(result: AdapterContractResult): AdapterConformanceScenarioResult {
  if (result.status === "unsupported") {
    return {
      scenario: result.scenario,
      status: "unsupported",
      summary: "The adapter author explicitly marked this scenario as unsupported."
    };
  }
  if (result.passed) {
    return {
      scenario: result.scenario,
      status: "passed",
      summary: "The adapter satisfied the public conformance scenario."
    };
  }
  return {
    scenario: result.scenario,
    status: "failed",
    summary: "The adapter did not satisfy the public conformance scenario."
  };
}

export function parseAdapterConformanceReceipt(value: unknown): AdapterConformanceReceipt {
  return adapterConformanceReceiptSchema.parse(value);
}

export function digestAdapterConformanceReceipt(value: unknown): string {
  return digestAnalysisArtifact(parseAdapterConformanceReceipt(value));
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
            detail: error instanceof Error ? error.message : String(error),
            status: "failed"
          });
        }
      }
      return results;
    },
    async runReceipt(): Promise<AdapterConformanceReceipt> {
      const results: AdapterContractResult[] = [];
      for (const scenario of adapterContractScenarios) {
        try {
          results.push(await runScenario(definition, scenario));
        } catch {
          results.push({
            scenario,
            passed: false,
            detail: "scenario failed",
            status: "failed"
          });
        }
      }
      const scenarios = results.map(toReceiptResult);
      const failed = scenarios.some((result) => result.status === "failed");
      const unsupported = scenarios.some((result) => result.status === "unsupported");
      const provider = providerFor(definition);
      return adapterConformanceReceiptSchema.parse({
        schemaVersion: ADAPTER_CONFORMANCE_CONTRACT_VERSION,
        kind: "writeguard_adapter_conformance_receipt",
        provider,
        overallResult: failed ? "failed" : unsupported ? "passed_with_unsupported" : "passed",
        scenarios,
        verifiedGuarantees: scenarios
          .filter((result) => result.status === "passed")
          .map((result) => `Scenario ${result.scenario} passed in ${provider.environment}.`),
        limitations: [
          "Conformance evidence applies only to the declared provider environment.",
          "Passing scenarios do not certify production behavior or undeclared provider guarantees.",
          ...(unsupported
            ? ["Unsupported scenarios remain unverified and must not be represented as passed."]
            : [])
        ]
      });
    }
  };
}

export { ConfirmedExecutionFailure };
