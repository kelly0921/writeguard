import {
  UnknownExecutionOutcome,
  createUnsafeInMemoryStorage,
  createWriteGuard
} from "@closure/writeguard";
import { createRefundOrderGuardedTool } from "../generated/src/guarded-tool.js";
import type { ToolInput } from "../generated/src/input.js";
import { SimulatedRefundProvider } from "../generated/provider/simulated-refund.js";

const input: ToolInput = {
  tenantId: "tenant-evaluation",
  orderId: "order-evaluation",
  paymentIntentId: "redacted-provider-reference",
  amount: 2500,
  currency: "USD"
};

const unsafeProvider = new SimulatedRefundProvider();
unsafeProvider.unsafeRefund();
unsafeProvider.unsafeRefund();

const storage = createUnsafeInMemoryStorage();
const guardedProvider = new SimulatedRefundProvider("timeout_after_success");
const guarded = createRefundOrderGuardedTool(
  createWriteGuard({ storage, namespace: "evaluation-release-candidate" }),
  guardedProvider
);
let unknownObserved = false;
try {
  try {
    await guarded.invoke(input, {
      framework: "evaluation",
      toolCallId: "call-a"
    });
  } catch (error) {
    if (!(error instanceof UnknownExecutionOutcome)) throw error;
    unknownObserved = true;
  }
  const receipt = await guarded.invoke(input, {
    framework: "evaluation",
    toolCallId: "call-b"
  });
  if (!unknownObserved || receipt.status !== "CONFIRMED") {
    throw new Error("The guarded evaluation did not reconcile the simulated unknown outcome.");
  }
  if (unsafeProvider.effectCount() !== 2 || guardedProvider.effectCount() !== 1) {
    throw new Error("The evaluation effect counts do not match the required demonstration.");
  }
  console.log(JSON.stringify({
    unsafeExternalEffects: unsafeProvider.effectCount(),
    guardedExternalEffects: guardedProvider.effectCount(),
    unknownObserved,
    guardedReceiptStatus: receipt.status,
    duplicateExecutionPrevented: receipt.duplicateExecutionPrevented,
    provider: {
      id: "simulated-refund-adapter",
      environment: "simulated"
    }
  }));
} finally {
  await storage.close();
}
