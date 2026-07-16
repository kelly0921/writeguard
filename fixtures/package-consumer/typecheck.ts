import {
  createUnsafeInMemoryStorage,
  createWriteGuard,
  type ReconciliationOutcome
} from "@closure/writeguard";
import {
  analysisContractVersion,
  normalizeMcpToolDefinition,
  type NormalizedToolDefinition,
  type ToolRiskAnalyzer
} from "@closure/writeguard/analysis";

type ProviderResult = { id: string; operationId: string; status: "succeeded" };

const storage = createUnsafeInMemoryStorage();
const guard = createWriteGuard({ storage, namespace: "clean-consumer-typecheck" });

void guard.execute<ProviderResult>({
  key: "tenant:order:refund:usd:100",
  action: { name: "refund_order", provider: "fixture" },
  execute: async ({ operationId }) => ({ id: "result_1", operationId, status: "succeeded" }),
  reconcile: async ({ operationId }): Promise<ReconciliationOutcome<ProviderResult>> => ({
    kind: "found",
    result: { id: "result_1", operationId, status: "succeeded" },
    evidence: { matchCount: 1 }
  }),
  verify: async (result, context) =>
    result.status === "succeeded" && result.operationId === context.operationId
});

const normalized: NormalizedToolDefinition = normalizeMcpToolDefinition({
  name: "lookup_order",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string" } },
    required: ["orderId"]
  },
  annotations: { readOnlyHint: true }
});
void normalized;
void analysisContractVersion;
declare const futureAnalyzer: ToolRiskAnalyzer;
void futureAnalyzer;
