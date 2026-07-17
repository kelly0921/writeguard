import assert from "node:assert/strict";
import test from "node:test";
import {
  UnknownExecutionOutcome,
  createUnsafeInMemoryStorage,
  createWriteGuard
} from "@closure/writeguard";
import { createSendCustomerEmailGuardedTool } from "../generated/src/guarded-tool.js";
import type { ToolInput } from "../generated/src/input.js";
import { SimulatedEmailProvider } from "../generated/provider/simulated-email.js";

const input: ToolInput = {
  tenantId: "tenant-email",
  messageId: "message-42",
  recipientEmail: "customer@example.invalid",
  subject: "Sensitive support subject",
  body: "Sensitive support content"
};
const invocation = (toolCallId: string) => ({ framework: "email-pilot", toolCallId });

test("unsafe retry can create two simulated email-send effects", () => {
  const provider = new SimulatedEmailProvider();
  provider.unsafeSend();
  provider.unsafeSend();
  assert.equal(provider.effectCount(), 2);
});

test("generated guarded email reconciles timeout after apparent provider success", async () => {
  const storage = createUnsafeInMemoryStorage();
  const provider = new SimulatedEmailProvider("timeout_after_success");
  const guarded = createSendCustomerEmailGuardedTool(
    createWriteGuard({ storage, namespace: "iteration-4-email-timeout" }),
    provider
  );
  try {
    await assert.rejects(guarded.invoke(input, invocation("timeout-a")), UnknownExecutionOutcome);
    const receipt = await guarded.invoke(input, invocation("timeout-b"));
    assert.equal(receipt.status, "CONFIRMED");
    assert.equal(provider.effectCount(), 1);
    const serialized = JSON.stringify(receipt);
    assert.equal(serialized.includes(input.recipientEmail), false);
    assert.equal(serialized.includes(input.subject), false);
    assert.equal(serialized.includes(input.body), false);
  } finally {
    await storage.close();
  }
});

test("generated guarded email converges concurrent sends on one effect", async () => {
  const storage = createUnsafeInMemoryStorage();
  const provider = new SimulatedEmailProvider();
  const guarded = createSendCustomerEmailGuardedTool(
    createWriteGuard({ storage, namespace: "iteration-4-email-concurrency" }),
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
