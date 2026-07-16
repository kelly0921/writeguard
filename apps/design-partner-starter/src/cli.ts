import pg from "pg";
import {
  createLocalPilotTelemetry,
  createPostgresStorage,
  createWriteGuard,
  migratePostgresStorage
} from "@closure/writeguard";
import { SandboxRefundProvider } from "./provider.js";
import {
  StarterRefundWorkflow,
  ensureStarterSchema,
  getStarterCase,
  runManualRefund,
  runUnsafeRefund,
  seedStarterCase,
  starterOperationKey
} from "./workflow.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://closure:closure@localhost:54327/closure";
const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });
await migratePostgresStorage({ connectionString: databaseUrl });
await ensureStarterSchema(pool);
const telemetry = createLocalPilotTelemetry({
  filePath: process.env.WRITEGUARD_TELEMETRY_FILE ?? ".writeguard/starter-telemetry.jsonl"
});

const base = {
  caseId: `starter-case-${Date.now()}`,
  tenantId: "demo-tenant",
  orderId: "order-781",
  paymentIntentId: `pi_starter_${Date.now()}`,
  amount: 100,
  currency: "usd",
  frameworkToolCallId: "call_A"
};

const unsafeProvider = new SandboxRefundProvider("timeout_after_success");
for (const frameworkToolCallId of ["call_A", "call_B"]) {
  try {
    await runUnsafeRefund(unsafeProvider, { ...base, frameworkToolCallId });
  } catch {
    // The ordinary application retries because it cannot distinguish timeout from failure.
  }
}

const manualProvider = new SandboxRefundProvider("timeout_after_success");
try {
  await runManualRefund(pool, manualProvider, { ...base, orderId: "order-manual", frameworkToolCallId: "call_A" });
} catch {
  // Retry below reconciles the committed effect.
}
const manualResult = await runManualRefund(pool, manualProvider, {
  ...base,
  orderId: "order-manual",
  frameworkToolCallId: "call_B"
});

const enforcedProvider = new SandboxRefundProvider("timeout_after_success");
await seedStarterCase(pool, base);
const storage = createPostgresStorage({ connectionString: databaseUrl });
const writeGuard = createWriteGuard({
  storage,
  namespace: `starter:${base.caseId}`,
  telemetry,
  pollIntervalMs: 2
});
const workflow = new StarterRefundWorkflow(pool, writeGuard, enforcedProvider);
try {
  await workflow.enforce(base);
} catch {
  // Acknowledgement loss is intentionally surfaced as UNKNOWN.
}
const receipt = await workflow.enforce({ ...base, frameworkToolCallId: "call_B" });
const supportCase = await getStarterCase(pool, base.caseId);

console.log(JSON.stringify({
  stableOperationKey: starterOperationKey(base),
  unsafe: { invocations: 2, externalEffects: await unsafeProvider.countRefunds() },
  manual: {
    invocations: 2,
    externalEffects: await manualProvider.countRefunds(),
    result: manualResult
  },
  writeGuard: {
    frameworkToolCallIds: ["call_A", "call_B"],
    externalEffects: await enforcedProvider.countRefunds(),
    receipt,
    supportCase
  },
  telemetry: await telemetry.summary()
}, null, 2));

await storage.close();
await pool.end();
