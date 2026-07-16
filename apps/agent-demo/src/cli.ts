import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  PostgresFakeRefundProvider,
  PostgresOperationStore
} from "@writeguard/core";
import { WriteGuard } from "@writeguard/sdk";
import {
  callRefundOrderTool,
  connectInMemoryMcpClient,
  createRefundOrderMcpServer,
  refundOperationKey,
  type RefundOrderInput
} from "./refund-tool.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://closure:closure@localhost:54327/closure";
const pool = new Pool({ connectionString: databaseUrl });
const store = new PostgresOperationStore(pool);
const provider = new PostgresFakeRefundProvider(pool, { scenario: "timeout_after_success" });
const writeGuard = new WriteGuard({ store, namespace: "mcp-agent-demo", pollIntervalMs: 10 });
const server = createRefundOrderMcpServer({ writeGuard, provider });
const session = await connectInMemoryMcpClient(server);
const unsafePaymentIntentId = `pi_agent_unsafe_${Date.now()}`;
const domainInput: RefundOrderInput = {
  tenantId: "demo-tenant",
  orderId: "order-781",
  paymentIntentId: `pi_agent_${Date.now()}`,
  amount: 100,
  currency: "usd"
};

try {
  const unsafeProvider = new PostgresFakeRefundProvider(pool);
  for (const _frameworkToolCallId of ["call_A", "call_B"]) {
    await unsafeProvider.createRefund({
      operationId: randomUUID(),
      paymentIntentId: unsafePaymentIntentId,
      amount: 100,
      currency: "usd"
    });
  }
  const first = await callRefundOrderTool(session.client, {
    ...domainInput,
    frameworkToolCallId: "call_A"
  });
  const second = await callRefundOrderTool(session.client, {
    ...domainInput,
    frameworkToolCallId: "call_B"
  });
  const key = refundOperationKey(domainInput);
  const timeline = await store.getTimeline("mcp-agent-demo", key);
  const invocationIds = timeline?.events
    .filter((event) => event.eventType === "INVOCATION_RECEIVED")
    .map((event) => event.details.toolCallId);

  console.log("MCP agent-tool validation");
  console.log(JSON.stringify({
    unsafePath: {
      frameworkToolCallIds: ["call_A", "call_B"],
      identitySource: "ephemeral framework tool-call ID",
      businessIntentions: 1,
      externalRefunds: await unsafeProvider.countRefunds(unsafePaymentIntentId)
    },
    guardedMcpPath: {
      frameworkToolCallIds: ["call_A", "call_B"],
      stableOperationKey: key,
      firstCallReportedError: first.isError === true,
      secondCallReportedError: second.isError === true,
      durableInvocationTrace: invocationIds,
      finalReceipt: timeline?.receipt,
      externalRefunds: await provider.countRefunds(domainInput.paymentIntentId)
    }
  }, null, 2));
} finally {
  await session.close();
  await pool.end();
}
