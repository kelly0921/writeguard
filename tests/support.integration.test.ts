import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresFakeRefundProvider,
  PostgresOperationStore,
  UnknownExecutionOutcome
} from "@writeguard/core";
import { WriteGuard } from "@writeguard/sdk";
import {
  SupportRefundWorkflow,
  supportRefundOperationKey
} from "../apps/support-refund/src/workflow.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const { Pool } = pg;

integration("support refund workflow", () => {
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

  it("recovers the refund and resolves the application-owned support case", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool, { scenario: "timeout_after_success" });
    const guard = new WriteGuard({ store, namespace: "support-workflow-integration", pollIntervalMs: 2 });
    const workflow = new SupportRefundWorkflow(pool, guard, provider);
    const baseRequest = {
      caseId: "case-781-integration",
      tenantId: "demo-tenant",
      orderId: "order-781",
      paymentIntentId: "pi_support_integration",
      amount: 100,
      currency: "usd"
    };
    await workflow.seedCase({
      id: baseRequest.caseId,
      tenantId: baseRequest.tenantId,
      orderId: baseRequest.orderId
    });

    await expect(
      workflow.run({ ...baseRequest, frameworkToolCallId: "call_A" })
    ).rejects.toBeInstanceOf(UnknownExecutionOutcome);
    expect(await workflow.getCase(baseRequest.caseId)).toMatchObject({
      status: "OPEN",
      refundStatus: "PENDING",
      lastFrameworkToolCallId: "call_A"
    });

    const final = await workflow.run({ ...baseRequest, frameworkToolCallId: "call_B" });
    expect(final.supportCase).toMatchObject({
      status: "RESOLVED",
      refundStatus: "CONFIRMED",
      refundReceiptId: final.receipt.id,
      lastFrameworkToolCallId: "call_B"
    });
    expect(final.receipt).toMatchObject({
      status: "CONFIRMED",
      resolution: "reconciled_after_unknown_outcome",
      duplicateExecutionPrevented: true
    });
    expect(await provider.countRefunds(baseRequest.paymentIntentId)).toBe(1);

    const timeline = await store.getTimeline(
      "support-workflow-integration",
      supportRefundOperationKey(baseRequest)
    );
    expect(
      timeline?.events
        .filter((event) => event.eventType === "INVOCATION_RECEIVED")
        .map((event) => event.details.toolCallId)
    ).toEqual(["call_A", "call_B"]);
  });
});
