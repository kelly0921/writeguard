import assert from "node:assert/strict";
import test from "node:test";
import {
  UnknownExecutionOutcome,
  createUnsafeInMemoryStorage,
  createWriteGuard
} from "@closure/writeguard";
import { createRefundOrderGuardedTool } from "../generated/src/guarded-tool.js";
import type { ToolInput } from "../generated/src/input.js";
import { SimulatedRefundProvider } from "../generated/provider/simulated-refund.js";

const input: ToolInput = {
  tenantId: "tenant-refund",
  orderId: "order-42",
  paymentIntentId: "provider-payment-reference",
  amount: 2500,
  currency: "USD"
};
const invocation = (toolCallId: string) => ({ framework: "refund-pilot", toolCallId });

test("unsafe retry can create two simulated refund effects", () => {
  const provider = new SimulatedRefundProvider();
  provider.unsafeRefund();
  provider.unsafeRefund();
  assert.equal(provider.effectCount(), 2);
});

test("generated guarded refund converges concurrent attempts on one simulated effect", async () => {
  const storage = createUnsafeInMemoryStorage();
  const provider = new SimulatedRefundProvider();
  const guarded = createRefundOrderGuardedTool(
    createWriteGuard({ storage, namespace: "iteration-4-refund-concurrency" }),
    provider
  );
  try {
    await Promise.all([
      guarded.invoke(input, invocation("concurrent-a")),
      guarded.invoke(input, invocation("concurrent-b"))
    ]);
    assert.equal(provider.effectCount(), 1);
  } finally {
    await storage.close();
  }
});

test("timeout after simulated refund success reconciles before retry", async () => {
  const storage = createUnsafeInMemoryStorage();
  const provider = new SimulatedRefundProvider("timeout_after_success");
  const guarded = createRefundOrderGuardedTool(
    createWriteGuard({ storage, namespace: "iteration-4-refund-timeout" }),
    provider
  );
  try {
    await assert.rejects(guarded.invoke(input, invocation("timeout-a")), UnknownExecutionOutcome);
    const receipt = await guarded.invoke(input, invocation("timeout-b"));
    assert.equal(receipt.status, "CONFIRMED");
    assert.equal(provider.effectCount(), 1);
  } finally {
    await storage.close();
  }
});
