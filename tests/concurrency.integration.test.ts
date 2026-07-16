import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresFakeRefundProvider,
  PostgresOperationStore,
  type FakeRefund
} from "@writeguard/core";
import { WriteGuard, type WriteGuardExecutionOptions } from "@writeguard/sdk";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const { Pool } = pg;

function optionsFor(
  provider: PostgresFakeRefundProvider,
  key: string,
  paymentIntentId: string,
  delayMs = 0
): WriteGuardExecutionOptions<FakeRefund> {
  return {
    key,
    action: { name: "refund.create", provider: "fake-payments", effectType: "reversible_write" },
    fingerprint: { paymentIntentId, amount: 100, currency: "usd" },
    metadata: { paymentIntentId, amount: 100, currency: "usd" },
    execute: async (context) => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return provider.createRefund({
        operationId: context.operationId,
        paymentIntentId,
        amount: 100,
        currency: "usd"
      });
    },
    reconcile: (context) => provider.reconcile(context.operationId, paymentIntentId),
    verify: async (refund, context) => refund.operationId === context.operationId,
    getProviderReference: (refund) => refund.id
  };
}

async function runCrashWorker(input: {
  databaseUrl: string;
  namespace: string;
  key: string;
  paymentIntentId: string;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const workerPath = fileURLToPath(
    new URL("../apps/refund-demo/src/crash-worker.ts", import.meta.url)
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", workerPath], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: input.databaseUrl,
        CRASH_NAMESPACE: input.namespace,
        CRASH_OPERATION_KEY: input.key,
        CRASH_PAYMENT_INTENT_ID: input.paymentIntentId,
        CRASH_CLAIM_TTL_MS: "50"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

integration("multi-worker validation", () => {
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

  it("gives ten concurrent callers one durable operation, receipt, and external effect", async () => {
    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool);
    const key = "concurrency:order-781:refund:usd:100";
    const paymentIntentId = "pi_concurrency_ten";
    const options = optionsFor(provider, key, paymentIntentId, 40);
    const workers = Array.from(
      { length: 10 },
      () => new WriteGuard({ store, namespace: "concurrency-ten", pollIntervalMs: 2 })
    );

    const receipts = await Promise.all(workers.map((worker) => worker.execute(options)));
    expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1);
    expect(receipts.every((receipt) => receipt.status === "CONFIRMED")).toBe(true);
    expect(await provider.countRefunds(paymentIntentId)).toBe(1);
    const operationCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM writeguard_operations WHERE namespace = $1 AND operation_key = $2",
      ["concurrency-ten", key]
    );
    expect(operationCount.rows[0]?.count).toBe("1");
  });

  it("recovers after a real child process terminates after provider success", async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
    const namespace = "child-process-crash";
    const key = "crash:order-781:refund:usd:100";
    const paymentIntentId = "pi_child_process_crash";
    const child = await runCrashWorker({ databaseUrl, namespace, key, paymentIntentId });
    expect(child.code).toBe(17);
    expect(child.stdout).toContain("external effect committed");
    expect(child.stderr).toBe("");
    await new Promise((resolve) => setTimeout(resolve, 75));

    const store = new PostgresOperationStore(pool);
    const provider = new PostgresFakeRefundProvider(pool);
    const guard = new WriteGuard({ store, namespace, pollIntervalMs: 2 });
    const receipt = await guard.execute(optionsFor(provider, key, paymentIntentId));

    expect(receipt).toMatchObject({
      status: "CONFIRMED",
      resolution: "reconciled_after_unknown_outcome",
      duplicateExecutionPrevented: true
    });
    expect(await provider.countRefunds(paymentIntentId)).toBe(1);
    const timeline = await store.getTimeline(namespace, key);
    expect(
      timeline?.events.some((event) => event.eventType === "STALE_SUBMISSION_BECAME_UNKNOWN")
    ).toBe(true);
  });
});
