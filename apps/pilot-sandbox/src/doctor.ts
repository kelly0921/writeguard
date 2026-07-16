import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  createPostgresStorage,
  createWriteGuard,
  isUnknownExecutionOutcome,
  WRITEGUARD_VERSION
} from "@closure/writeguard";
import { assertNoLiveStripeKey, type PilotConfig } from "./config.js";
import { PilotFakeRefundProvider } from "./provider.js";

const { Pool } = pg;

export type DoctorCheck = {
  name: string;
  status: "passed" | "failed";
  message: string;
};

export type DoctorReport = {
  status: "passed" | "failed";
  checks: DoctorCheck[];
};

const requiredTables = [
  "writeguard_operations",
  "writeguard_operation_attempts",
  "writeguard_operation_events",
  "writeguard_execution_receipts",
  "writeguard_shadow_observations",
  "writeguard_shadow_invocations"
];
const requiredMigrations = ["0000_initial", "0001_ordered_events", "0004_shadow_observations"];

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/sk_(?:test|live)_[A-Za-z0-9_-]+/g, "[REDACTED_STRIPE_KEY]");
}

export async function runDoctor(config: PilotConfig): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const pass = (name: string, message: string) => checks.push({ name, status: "passed", message });
  const fail = (name: string, message: string) => checks.push({ name, status: "failed", message });

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor >= 20) pass("Node runtime", `Node ${process.versions.node} satisfies >=20.`);
  else fail("Node runtime", `Node ${process.versions.node} is unsupported; install Node 20 or newer.`);

  try {
    const manifest = JSON.parse(
      await readFile(new URL("../../../packages/writeguard/package.json", import.meta.url), "utf8")
    ) as { name?: string; version?: string };
    if (manifest.name === "@closure/writeguard" && manifest.version === WRITEGUARD_VERSION) {
      pass("SDK package", `@closure/writeguard ${WRITEGUARD_VERSION} is available.`);
    } else {
      fail("SDK package", `Expected @closure/writeguard ${WRITEGUARD_VERSION}; reinstall the current package.`);
    }
  } catch (error) {
    fail("SDK package", `Could not read the SDK manifest: ${safeError(error)}`);
  }

  pass(
    "Configuration",
    `Validated ${config.mode} mode with ${config.provider} provider, PostgreSQL storage, reconciliation enabled, and fail-closed storage behavior.`
  );
  if (config.mode === "shadow") {
    pass("Mode behavior", "Shadow mode is observational and does not suppress or execute external writes.");
  } else {
    pass("Mode behavior", "Enforced mode is selected explicitly for the sandbox workflow.");
  }
  try {
    assertNoLiveStripeKey(["sk", "live", "example"].join("_"));
    fail("Live Stripe rejection", "The live-key rejection probe did not fail closed.");
  } catch {
    pass("Live Stripe rejection", "Live Stripe credentials are rejected before adapter initialization.");
  }

  const fakeProvider = new PilotFakeRefundProvider("timeout_after_success");
  if (await fakeProvider.ping()) pass("Fake provider", "Credential-free fake provider connectivity passed.");
  else fail("Fake provider", "Fake provider connectivity failed; reinstall workspace dependencies.");
  if (config.provider === "fake") {
    pass("Adapter configuration", "Fake adapter is configured and requires no credentials.");
  } else if (config.stripe.secretKey?.startsWith("sk_test_")) {
    pass("Adapter configuration", "Stripe adapter is configured with a test-mode credential.");
  } else {
    fail("Adapter configuration", "Stripe test provider is missing a test-mode credential.");
  }

  const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5_000 });
  let databaseReady = false;
  try {
    await pool.query("SELECT 1");
    databaseReady = true;
    pass("PostgreSQL connectivity", "PostgreSQL accepted a health query.");

    const migrationResult = await pool.query<{ name: string }>(
      "SELECT name FROM writeguard_schema_migrations WHERE name = ANY($1::text[])",
      [requiredMigrations]
    );
    const foundMigrations = new Set(migrationResult.rows.map((row) => row.name));
    const missingMigrations = requiredMigrations.filter((name) => !foundMigrations.has(name));
    if (missingMigrations.length === 0) {
      pass("Migration state", "All public migrations are applied.");
    } else {
      fail("Migration state", `Run pilot:setup; missing migrations: ${missingMigrations.join(", ")}.`);
    }

    const tableResult = await pool.query<{ name: string; present: string | null }>(
      "SELECT name, to_regclass(name) AS present FROM unnest($1::text[]) AS name",
      [requiredTables]
    );
    const missingTables = tableResult.rows.filter((row) => row.present === null).map((row) => row.name);
    if (missingTables.length === 0) pass("Required tables", "All ledger and shadow tables are present.");
    else fail("Required tables", `Run pilot:setup; missing tables: ${missingTables.join(", ")}.`);
  } catch (error) {
    fail("PostgreSQL connectivity", `Start the sandbox with pnpm pilot:start. ${safeError(error)}`);
    fail("Migration state", "Not checked because PostgreSQL is unavailable.");
    fail("Required tables", "Not checked because PostgreSQL is unavailable.");
  }

  if (databaseReady) {
    const storage = createPostgresStorage({ connectionString: config.databaseUrl });
    const namespace = `${config.namespace}:doctor`;
    try {
      await pool.query("DELETE FROM writeguard_shadow_observations WHERE namespace = $1", [namespace]);
      await pool.query("DELETE FROM writeguard_operations WHERE namespace = $1", [namespace]);
      const probeProvider = new PilotFakeRefundProvider("timeout_after_success");
      const writeGuard = createWriteGuard({ storage, namespace, pollIntervalMs: 2 });
      pass("Storage health", "The packaged PostgreSQL storage adapter initialized successfully.");
      const execute = (toolCallId: string) =>
        writeGuard.execute({
          key: "doctor:refund:100:usd",
          action: { name: "doctor_refund", provider: "fake-payments", effectType: "irreversible_write" },
          fingerprint: { amount: 100, currency: "usd" },
          metadata: { workflow: "doctor_probe" },
          invocation: { framework: "doctor", toolName: "doctor_refund", toolCallId },
          execute: (context) =>
            probeProvider.createRefund({
              operationId: context.operationId,
              businessKey: context.operationKey,
              paymentIntentId: "doctor-payment",
              amount: 100,
              currency: "usd"
            }),
          reconcile: (context) =>
            probeProvider.reconcileByOperationId(context.operationId, "doctor-payment"),
          verify: async (refund, context) =>
            refund.operationId === context.operationId && refund.status === "succeeded",
          getProviderReference: (refund) => refund.id
        });
      let unknownObserved = false;
      try {
        await execute("doctor_A");
      } catch (error) {
        unknownObserved = isUnknownExecutionOutcome(error);
      }
      if (unknownObserved) pass("Unknown-outcome handling", "Fake acknowledgement loss was recorded as UNKNOWN.");
      else fail("Unknown-outcome handling", "The fake acknowledgement-loss probe did not produce UNKNOWN.");
      const receipt = await execute("doctor_B");
      if (receipt.status === "CONFIRMED" && receipt.verified) {
        pass("Receipt creation", "A verified local fake-provider receipt was created.");
      } else {
        fail("Receipt creation", `Expected CONFIRMED receipt; received ${receipt.status}.`);
      }
      if (receipt.resolution === "reconciled_after_unknown_outcome" && probeProvider.countRefunds() === 1) {
        pass("Reconciliation readiness", "UNKNOWN reconciled to one fake external effect without re-execution.");
      } else {
        fail("Reconciliation readiness", "The reconciliation probe did not suppress duplicate execution.");
      }
    } catch (error) {
      fail("Storage health", `The PostgreSQL-backed probe failed: ${safeError(error)}`);
      fail("Receipt creation", "Not completed because the storage probe failed.");
      fail("Reconciliation readiness", "Not completed because the storage probe failed.");
    } finally {
      await pool.query("DELETE FROM writeguard_operations WHERE namespace = $1", [namespace]).catch(() => undefined);
      await storage.close();
    }
  } else {
    fail("Storage health", "Not checked because PostgreSQL is unavailable.");
    fail("Receipt creation", "Not checked because PostgreSQL is unavailable.");
    fail("Reconciliation readiness", "Not checked because PostgreSQL is unavailable.");
  }

  await pool.end().catch(() => undefined);
  return {
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks
  };
}
