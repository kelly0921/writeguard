import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PostgresOperationStore } from "@writeguard/core";
import { WriteGuard } from "@writeguard/sdk";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const { Pool } = pg;

integration("PostgreSQL shadow mode", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    for (const migration of ["0000_initial", "0001_ordered_events", "0004_shadow_observations"]) {
      const sql = await readFile(
        new URL(`../packages/core/drizzle/${migration}.sql`, import.meta.url),
        "utf8"
      );
      await pool.query(sql);
    }
    await pool.query(
      "TRUNCATE writeguard_shadow_invocations, writeguard_shadow_observations CASCADE"
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("persists two redacted agent invocations while never entering the enforcement ledger", async () => {
    const store = new PostgresOperationStore(pool);
    const guard = new WriteGuard({ store, namespace: "shadow-integration" });
    const writeThatShadowMustNeverCall = vi.fn();
    const key = "tenant_123:order_781:refund:usd:100";
    const first = await guard.observe({
      key,
      action: { name: "refund_order", provider: "fake-payments" },
      fingerprint: { tenantId: "tenant_123", orderId: "order_781", amount: 100, currency: "usd" },
      reportedInvocation: {
        framework: "mcp",
        toolName: "refund_order",
        toolCallId: "call_A",
        metadata: { apiKey: "must-be-redacted" }
      },
      reconcile: async () => ({ kind: "not_found", evidence: { matchCount: 0 } })
    });
    const providerResult = {
      id: "shadow_refund_1",
      observationId: first.observationId,
      status: "succeeded" as const
    };
    const second = await guard.observe({
      key,
      action: { name: "refund_order", provider: "fake-payments" },
      fingerprint: { tenantId: "tenant_123", orderId: "order_781", amount: 100, currency: "usd" },
      reportedInvocation: {
        framework: "mcp",
        toolName: "refund_order",
        toolCallId: "call_B",
        metadata: { apiKey: "must-be-redacted" }
      },
      reconcile: async () => ({
        kind: "found",
        result: providerResult,
        evidence: { matchCount: 1, providerPayload: "not persisted" }
      }),
      verify: async (result, context) =>
        result.status === "succeeded" && result.observationId === context.observationId,
      getProviderReference: (result) => result.id
    });

    expect(second).toMatchObject({
      mode: "shadow",
      observational: true,
      invocationCount: 2,
      duplicateInvocationObserved: true,
      wouldSuppressDuplicate: true,
      classification: "verified_external_effect",
      providerReference: "shadow_refund_1"
    });
    expect(writeThatShadowMustNeverCall).not.toHaveBeenCalled();
    const enforcedCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM writeguard_operations WHERE namespace = $1",
      ["shadow-integration"]
    );
    expect(Number(enforcedCount.rows[0]?.count)).toBe(0);
    const invocations = await pool.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM writeguard_shadow_invocations
       WHERE shadow_observation_id = $1 ORDER BY invocation_number`,
      [first.observationId]
    );
    expect(invocations.rows.map((row) => row.details.toolCallId)).toEqual(["call_A", "call_B"]);
    expect(invocations.rows.every((row) => row.details.apiKey === "[REDACTED]")).toBe(true);
    expect(JSON.stringify(invocations.rows)).not.toContain("must-be-redacted");
  });
});
