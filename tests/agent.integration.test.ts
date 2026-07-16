import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
} from "../apps/agent-demo/src/refund-tool.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const { Pool } = pg;

integration("MCP agent tool integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    for (const migration of [
      "0000_initial",
      "0001_ordered_events",
      "0002_support_cases",
      "0003_support_case_cardinality",
      "0004_shadow_observations",
      "0005_fake_provider_test_schema"
    ]) {
      await pool.query(
        await readFile(new URL(`../packages/core/drizzle/${migration}.sql`, import.meta.url), "utf8")
      );
    }
    await pool.query(
      "TRUNCATE writeguard_shadow_invocations, writeguard_shadow_observations, support_cases, writeguard_execution_receipts, writeguard_operation_events, writeguard_operation_attempts, writeguard_operations, fake_provider_refunds CASCADE"
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("maps call_A and call_B to one stable business operation and one durable receipt", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool, { scenario: "timeout_after_success" });
    const guard = new WriteGuard({ store, namespace: "mcp-agent-integration", pollIntervalMs: 2 });
    const server = createRefundOrderMcpServer({ writeGuard: guard, provider });
    const session = await connectInMemoryMcpClient(server);
    const domainInput: RefundOrderInput = {
      tenantId: "demo-tenant",
      orderId: "order-781",
      paymentIntentId: "pi_mcp_agent_integration",
      amount: 100,
      currency: "usd"
    };

    try {
      const tools = await session.client.listTools();
      const definition = tools.tools.find((tool) => tool.name === "refund_order");
      expect(definition?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      });

      const first = await callRefundOrderTool(session.client, {
        ...domainInput,
        frameworkToolCallId: "call_A"
      });
      const second = await callRefundOrderTool(session.client, {
        ...domainInput,
        frameworkToolCallId: "call_B"
      });

      expect(first.isError).toBe(true);
      expect(first.structuredContent).toMatchObject({
        frameworkToolCallId: "call_A",
        status: "UNKNOWN"
      });
      expect(second.isError).not.toBe(true);
      expect(second.structuredContent).toMatchObject({
        frameworkToolCallId: "call_B",
        stableOperationKey: "demo-tenant:order-781:refund:usd:100",
        receipt: {
          status: "CONFIRMED",
          resolution: "reconciled_after_unknown_outcome",
          duplicateExecutionPrevented: true
        }
      });

      const key = refundOperationKey(domainInput);
      const timeline = await store.getTimeline("mcp-agent-integration", key);
      const invocationIds = timeline?.events
        .filter((event) => event.eventType === "INVOCATION_RECEIVED")
        .map((event) => event.details.toolCallId);
      expect(invocationIds).toEqual(["call_A", "call_B"]);
      expect(timeline?.receipt?.status).toBe("CONFIRMED");
      expect(await provider.countRefunds(domainInput.paymentIntentId)).toBe(1);

      const operationCount = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM writeguard_operations WHERE namespace = $1 AND operation_key = $2",
        ["mcp-agent-integration", key]
      );
      expect(operationCount.rows[0]?.count).toBe("1");
    } finally {
      await session.close();
    }
  });
});
