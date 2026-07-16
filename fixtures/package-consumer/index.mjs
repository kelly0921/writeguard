import assert from "node:assert/strict";
import {
  UnknownExecutionOutcome,
  createUnsafeInMemoryStorage,
  createWriteGuard
} from "@closure/writeguard";
import {
  analysisContractVersion,
  normalizeMcpToolDefinition
} from "@closure/writeguard/analysis";

const storage = createUnsafeInMemoryStorage();
const writeGuard = createWriteGuard({
  storage,
  namespace: "clean-package-consumer",
  pollIntervalMs: 1
});
const effects = [];
const key = "tenant_123:order_781:refund:usd:100";
const options = {
  key,
  action: {
    name: "refund_order",
    provider: "clean-fixture",
    effectType: "conditionally_reversible"
  },
  fingerprint: { tenantId: "tenant_123", orderId: "order_781", amount: 100, currency: "usd" },
  execute: async ({ operationId }) => {
    const result = { id: "fixture_refund_1", operationId, status: "succeeded" };
    effects.push(result);
    return result;
  },
  reconcile: async ({ operationId }) => ({
    kind: "found",
    result: effects.find((effect) => effect.operationId === operationId),
    evidence: { matchCount: effects.filter((effect) => effect.operationId === operationId).length }
  }),
  verify: async (result, context) =>
    result?.status === "succeeded" && result.operationId === context.operationId,
  faults: { throwAfterExternalSuccess: true },
  getProviderReference: (result) => result.id
};

await assert.rejects(() => writeGuard.execute(options), UnknownExecutionOutcome);
options.faults.throwAfterExternalSuccess = false;
const receipt = await writeGuard.execute(options);

assert.equal(receipt.status, "CONFIRMED");
assert.equal(receipt.duplicateExecutionPrevented, true);
assert.equal(effects.length, 1);
await storage.close();

const normalized = normalizeMcpToolDefinition({
  name: "lookup_order",
  description: "Read an order",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string" } },
    required: ["orderId"]
  },
  annotations: { readOnlyHint: true }
});
assert.equal(normalized.schemaVersion, analysisContractVersion);
assert.equal(normalized.tool.name, "lookup_order");

console.log(JSON.stringify({
  packageImport: "@closure/writeguard",
  analysisImport: "@closure/writeguard/analysis",
  normalizedTool: normalized.tool.name,
  status: receipt.status,
  externalEffects: effects.length,
  duplicateExecutionPrevented: receipt.duplicateExecutionPrevented
}));
