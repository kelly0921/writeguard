import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WRITEGUARD_VERSION, createLocalPilotTelemetry } from "@closure/writeguard";
import type { PilotConfig } from "./config.js";

export type SanitizedPilotExport = {
  schemaVersion: 1;
  generatedAt: string;
  evaluationOnly: true;
  sdkVersion: typeof WRITEGUARD_VERSION;
  pilotConfiguration: {
    mode: "shadow" | "enforced";
    providerCategory: "fake" | "stripe-test";
    storage: "postgresql";
    telemetryEnabled: boolean;
    reconciliationEnabled: boolean;
    receiptRetentionDays: number;
    sensitiveFieldPolicy: "omit" | "redact";
    failClosedOnStorageError: true;
    namespaceHash: string;
  };
  observationPeriod: { from: string; to: string };
  aggregates: {
    operationsObserved: number;
    guardedOperations: number;
    shadowOperations: number;
    duplicateInvocationsObserved: number;
    unknownOutcomesObserved: number;
    successfulReconciliations: number;
    ambiguousReconciliations: number;
    needsReview: number;
    suppressedExecutions: number;
    storageErrors: number;
    averageExecutionLatencyMs: number | null;
    averageReconciliationLatencyMs: number | null;
  };
};

export async function createSanitizedPilotExport(config: PilotConfig): Promise<SanitizedPilotExport> {
  const telemetry = createLocalPilotTelemetry({ filePath: config.telemetryFile });
  const summary = await telemetry.summary();
  const separator = summary.period.indexOf("/");
  const from = separator === -1 ? "empty" : summary.period.slice(0, separator);
  const to = separator === -1 ? "empty" : summary.period.slice(separator + 1);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evaluationOnly: true,
    sdkVersion: WRITEGUARD_VERSION,
    pilotConfiguration: {
      mode: config.mode,
      providerCategory: config.provider,
      storage: config.storage,
      telemetryEnabled: config.telemetryEnabled,
      reconciliationEnabled: config.reconciliationEnabled,
      receiptRetentionDays: config.receiptRetentionDays,
      sensitiveFieldPolicy: config.sensitiveFieldPolicy,
      failClosedOnStorageError: true,
      namespaceHash: createHash("sha256").update(config.namespace).digest("hex").slice(0, 16)
    },
    observationPeriod: { from, to },
    aggregates: {
      operationsObserved: summary.operations,
      guardedOperations: summary.guardedOperations,
      shadowOperations: summary.observedOperations,
      duplicateInvocationsObserved: summary.duplicateInvocations,
      unknownOutcomesObserved: summary.unknownOutcomes,
      successfulReconciliations: summary.successfulReconciliations,
      ambiguousReconciliations: summary.ambiguousReconciliations,
      needsReview: summary.needsReview,
      suppressedExecutions: summary.suppressedExecutions,
      storageErrors: summary.storageErrors,
      averageExecutionLatencyMs: summary.executionLatency.averageMs,
      averageReconciliationLatencyMs: summary.reconciliationLatency.averageMs
    }
  };
}

export async function writeSanitizedPilotExport(
  config: PilotConfig,
  destination = join(dirname(config.telemetryFile), "pilot-export.json")
): Promise<string> {
  const report = await createSanitizedPilotExport(config);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return destination;
}

export async function writePilotReport(
  config: PilotConfig,
  destination = join(dirname(config.telemetryFile), "pilot-report.md")
): Promise<string> {
  const report = await createSanitizedPilotExport(config);
  const lines = [
    "# Local Pilot Report",
    "",
    "Sandbox and design-partner evaluation only; not production-certified.",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.pilotConfiguration.mode}`,
    `Provider category: ${report.pilotConfiguration.providerCategory}`,
    `Observation period: ${report.observationPeriod.from} to ${report.observationPeriod.to}`,
    "",
    "| Aggregate | Value |",
    "|---|---:|",
    ...Object.entries(report.aggregates).map(([name, value]) => `| ${name} | ${value ?? "n/a"} |`),
    "",
    "This report contains aggregate counters and latency summaries only. Inspect it locally before sharing."
  ];
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${lines.join("\n")}\n`, "utf8");
  return destination;
}
