import { createHash } from "node:crypto";
import pg from "pg";
import {
  createLocalPilotTelemetry,
  createPostgresStorage,
  createWriteGuard,
  isUnknownExecutionOutcome
} from "@closure/writeguard";
import type { PilotConfig } from "./config.js";
import { PilotFakeRefundProvider } from "./provider.js";
import { setupPilotState } from "./state.js";
import {
  PilotRefundWorkflow,
  readPilotCase,
  runUnsafeRefund,
  seedPilotCase,
  type PilotRefundRequest
} from "./workflow.js";

const { Pool } = pg;

export type PilotScenarioResult = {
  mode: "shadow" | "enforced";
  provider: "fake";
  operationKeyHash: string;
  frameworkInvocations: number;
  externalEffects: number;
  finalStatus: string;
  duplicateBehavior: "observed_not_suppressed" | "reconciled_and_suppressed";
  supportCase: { status: string; refundStatus: string; hasReceipt: boolean };
  telemetry: Awaited<ReturnType<ReturnType<typeof createLocalPilotTelemetry>["summary"]>> | null;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export async function runFakePilotScenario(config: PilotConfig): Promise<PilotScenarioResult> {
  await setupPilotState(config);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const storage = createPostgresStorage({ connectionString: config.databaseUrl });
  const telemetry = config.telemetryEnabled
    ? createLocalPilotTelemetry({ filePath: config.telemetryFile })
    : undefined;
  const writeGuard = createWriteGuard({
    storage,
    namespace: config.namespace,
    pollIntervalMs: 2,
    ...(telemetry ? { telemetry } : {})
  });
  const provider = new PilotFakeRefundProvider("timeout_after_success");
  const workflow = new PilotRefundWorkflow(
    pool,
    writeGuard,
    provider,
    config.sensitiveFieldPolicy
  );
  const request: PilotRefundRequest = {
    caseId: "pilot-case-001",
    tenantId: "pilot-tenant",
    orderId: "pilot-order-001",
    paymentIntentId: "pilot-payment-001",
    amount: 100,
    currency: "usd",
    frameworkToolCallId: "call_A"
  };
  await seedPilotCase(pool, request.caseId);

  try {
    if (config.mode === "shadow") {
      for (const frameworkToolCallId of ["call_A", "call_B"]) {
        try {
          await runUnsafeRefund(provider, { ...request, frameworkToolCallId });
        } catch {
          // The existing app retries because the provider acknowledgement was lost.
        }
      }
      await workflow.observe(request);
      const observation = await workflow.observe({ ...request, frameworkToolCallId: "call_B" });
      const caseState = await readPilotCase(pool, request.caseId);
      return {
        mode: "shadow",
        provider: "fake",
        operationKeyHash: hash(observation.operationKey),
        frameworkInvocations: 2,
        externalEffects: provider.countRefunds(),
        finalStatus: observation.classification,
        duplicateBehavior: "observed_not_suppressed",
        supportCase: caseState,
        telemetry: telemetry ? await telemetry.summary() : null
      };
    }

    let unknownOutcomeObserved = false;
    try {
      await workflow.enforce(request);
    } catch (error) {
      unknownOutcomeObserved = isUnknownExecutionOutcome(error);
      if (!unknownOutcomeObserved) throw error;
    }
    if (!unknownOutcomeObserved) throw new Error("The enforced fake scenario did not surface UNKNOWN.");
    const receipt = await workflow.enforce({ ...request, frameworkToolCallId: "call_B" });
    const caseState = await readPilotCase(pool, request.caseId);
    return {
      mode: "enforced",
      provider: "fake",
      operationKeyHash: hash(receipt.operationKey),
      frameworkInvocations: 2,
      externalEffects: provider.countRefunds(),
      finalStatus: receipt.status,
      duplicateBehavior: "reconciled_and_suppressed",
      supportCase: caseState,
      telemetry: telemetry ? await telemetry.summary() : null
    };
  } finally {
    await storage.close();
    await pool.end();
  }
}
