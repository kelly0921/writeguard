import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalPilotTelemetry,
  createPostgresStorage,
  createWriteGuard,
  isUnknownExecutionOutcome,
  migratePostgresStorage
} from "@closure/writeguard";
import { SandboxRefundProvider } from "../apps/design-partner-starter/src/provider.js";
import {
  StarterRefundWorkflow,
  ensureStarterSchema,
  getStarterCase,
  runManualRefund,
  runUnsafeRefund,
  seedStarterCase,
  type StarterRefundRequest
} from "../apps/design-partner-starter/src/workflow.js";
import {
  connectStarterMcpClient,
  createStarterMcpServer
} from "../apps/design-partner-starter/src/mcp.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const { Pool } = pg;

function request(suffix: string, frameworkToolCallId = "call_A"): StarterRefundRequest {
  return {
    caseId: `starter-case-${suffix}`,
    tenantId: "demo-tenant",
    orderId: `order-${suffix}`,
    paymentIntentId: `pi_${suffix}`,
    amount: 100,
    currency: "usd",
    frameworkToolCallId
  };
}

integration("design-partner starter application", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await migratePostgresStorage({ connectionString: databaseUrl! });
    await ensureStarterSchema(pool);
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE
        design_partner_support_cases,
        design_partner_manual_refund_operations,
        writeguard_shadow_invocations,
        writeguard_shadow_observations,
        writeguard_execution_receipts,
        writeguard_operation_events,
        writeguard_operation_attempts,
        writeguard_operations
       CASCADE`
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("completes the support case after UNKNOWN and reconciliation through the packaged SDK", async () => {
    const input = request("enforced");
    await seedStarterCase(pool, input);
    const provider = new SandboxRefundProvider("timeout_after_success");
    const storage = createPostgresStorage({ connectionString: databaseUrl! });
    const workflow = new StarterRefundWorkflow(
      pool,
      createWriteGuard({ storage, namespace: "starter-enforced", pollIntervalMs: 2 }),
      provider
    );
    try {
      await workflow.enforce(input);
      throw new Error("first invocation should report UNKNOWN");
    } catch (error) {
      expect(isUnknownExecutionOutcome(error)).toBe(true);
    }
    expect(await getStarterCase(pool, input.caseId)).toMatchObject({
      status: "OPEN",
      refundStatus: "PENDING"
    });

    const receipt = await workflow.enforce({ ...input, frameworkToolCallId: "call_B" });
    expect(receipt).toMatchObject({
      status: "CONFIRMED",
      duplicateExecutionPrevented: true,
      resolution: "reconciled_after_unknown_outcome"
    });
    expect(await provider.countRefunds()).toBe(1);
    expect(await getStarterCase(pool, input.caseId)).toMatchObject({
      status: "RESOLVED",
      refundStatus: "CONFIRMED",
      receiptId: receipt.id
    });
    await storage.close();
  });

  it("observes uncontrolled duplicate writes without suppressing or adding an effect", async () => {
    const input = request("shadow");
    await seedStarterCase(pool, input);
    const provider = new SandboxRefundProvider("timeout_after_success");
    for (const frameworkToolCallId of ["call_A", "call_B"]) {
      try {
        await runUnsafeRefund(provider, { ...input, frameworkToolCallId });
      } catch {
        // The uncontrolled application retries the ambiguous timeout.
      }
    }
    const effectCountBeforeShadow = await provider.countRefunds();
    const storage = createPostgresStorage({ connectionString: databaseUrl! });
    const telemetry = createLocalPilotTelemetry({
      filePath: `.tmp/starter-shadow-${Date.now()}.jsonl`
    });
    const workflow = new StarterRefundWorkflow(
      pool,
      createWriteGuard({ storage, namespace: "starter-shadow", telemetry }),
      provider
    );
    await workflow.observe(input);
    const observation = await workflow.observe({ ...input, frameworkToolCallId: "call_B" });

    expect(observation).toMatchObject({
      mode: "shadow",
      observational: true,
      invocationCount: 2,
      duplicateInvocationObserved: true,
      wouldSuppressDuplicate: true,
      classification: "ambiguous_matches"
    });
    expect(await provider.countRefunds()).toBe(effectCountBeforeShadow);
    expect(await getStarterCase(pool, input.caseId)).toMatchObject({
      status: "OPEN",
      refundStatus: "NOT_REQUESTED"
    });
    expect(await telemetry.summary()).toMatchObject({
      observedOperations: 1,
      duplicateInvocations: 1,
      ambiguousReconciliations: 2
    });
    await storage.close();
  });

  it("shows the custom manual ledger code reconciling one effect", async () => {
    const input = request("manual");
    const provider = new SandboxRefundProvider("timeout_after_success");
    await expect(runManualRefund(pool, provider, input)).rejects.toThrow();
    const result = await runManualRefund(pool, provider, {
      ...input,
      frameworkToolCallId: "call_B"
    });
    expect(result.status).toBe("CONFIRMED");
    expect(await provider.countRefunds()).toBe(1);
  });

  it("exposes shadow and enforced behavior through a real MCP tool boundary", async () => {
    const input = request("mcp");
    await seedStarterCase(pool, input);
    const provider = new SandboxRefundProvider("timeout_after_success");
    const storage = createPostgresStorage({ connectionString: databaseUrl! });
    const workflow = new StarterRefundWorkflow(
      pool,
      createWriteGuard({ storage, namespace: "starter-mcp", pollIntervalMs: 2 }),
      provider
    );
    const server = createStarterMcpServer(workflow, "enforced");
    const connection = await connectStarterMcpClient(server);
    try {
      const first = await connection.client.callTool({ name: "refund_order", arguments: input });
      const second = await connection.client.callTool({
        name: "refund_order",
        arguments: { ...input, frameworkToolCallId: "call_B" }
      });
      expect(first.isError).toBe(true);
      expect(second.isError).not.toBe(true);
      expect(JSON.stringify(second.structuredContent)).toContain("CONFIRMED");
      expect(await provider.countRefunds()).toBe(1);
    } finally {
      await connection.close();
      await storage.close();
    }
  });
});
