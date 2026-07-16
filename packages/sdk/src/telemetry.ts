import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const pilotMetricNames = [
  "guarded_operation",
  "observed_operation",
  "duplicate_invocation",
  "unknown_outcome",
  "successful_reconciliation",
  "ambiguous_reconciliation",
  "needs_review",
  "suppressed_execution",
  "storage_error",
  "execution_latency",
  "reconciliation_latency"
] as const;

export type PilotMetricName = (typeof pilotMetricNames)[number];

export type PilotTelemetryEvent = {
  name: PilotMetricName;
  recordedAt: string;
  durationMs?: number;
};

export type PilotTelemetryRecord = {
  name: PilotMetricName;
  durationMs?: number;
};

export type PilotTelemetryPeriod = {
  from?: Date;
  to?: Date;
};

export type LatencySummary = {
  count: number;
  averageMs: number | null;
};

export type PilotSummary = {
  period: string;
  operations: number;
  guardedOperations: number;
  observedOperations: number;
  duplicateInvocations: number;
  unknownOutcomes: number;
  successfulReconciliations: number;
  ambiguousReconciliations: number;
  needsReview: number;
  suppressedExecutions: number;
  storageErrors: number;
  executionLatency: LatencySummary;
  reconciliationLatency: LatencySummary;
};

export interface PilotTelemetrySink {
  record(event: PilotTelemetryRecord): Promise<void>;
}

function isMetricName(value: unknown): value is PilotMetricName {
  return typeof value === "string" && (pilotMetricNames as readonly string[]).includes(value);
}

function parseLine(line: string): PilotTelemetryEvent | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (!isMetricName(value.name) || typeof value.recordedAt !== "string") return null;
    if (value.durationMs !== undefined && typeof value.durationMs !== "number") return null;
    return {
      name: value.name,
      recordedAt: value.recordedAt,
      ...(typeof value.durationMs === "number" ? { durationMs: value.durationMs } : {})
    };
  } catch {
    return null;
  }
}

function count(events: PilotTelemetryEvent[], name: PilotMetricName): number {
  return events.filter((event) => event.name === name).length;
}

function latency(events: PilotTelemetryEvent[], name: PilotMetricName): LatencySummary {
  const values = events
    .filter((event) => event.name === name && event.durationMs !== undefined)
    .map((event) => event.durationMs!);
  return {
    count: values.length,
    averageMs:
      values.length === 0
        ? null
        : Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100
  };
}

export function summarizePilotTelemetry(
  events: PilotTelemetryEvent[],
  period: PilotTelemetryPeriod = {}
): PilotSummary {
  const fromMs = period.from?.getTime() ?? Number.NEGATIVE_INFINITY;
  const toMs = period.to?.getTime() ?? Number.POSITIVE_INFINITY;
  const filtered = events.filter((event) => {
    const timestamp = Date.parse(event.recordedAt);
    return Number.isFinite(timestamp) && timestamp >= fromMs && timestamp <= toMs;
  });
  const ordered = [...filtered].sort(
    (left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
  );
  const periodStart = period.from?.toISOString() ?? ordered[0]?.recordedAt ?? "empty";
  const periodEnd = period.to?.toISOString() ?? ordered.at(-1)?.recordedAt ?? "empty";
  const guardedOperations = count(filtered, "guarded_operation");
  const observedOperations = count(filtered, "observed_operation");
  return {
    period: `${periodStart}/${periodEnd}`,
    operations: guardedOperations + observedOperations,
    guardedOperations,
    observedOperations,
    duplicateInvocations: count(filtered, "duplicate_invocation"),
    unknownOutcomes: count(filtered, "unknown_outcome"),
    successfulReconciliations: count(filtered, "successful_reconciliation"),
    ambiguousReconciliations: count(filtered, "ambiguous_reconciliation"),
    needsReview: count(filtered, "needs_review"),
    suppressedExecutions: count(filtered, "suppressed_execution"),
    storageErrors: count(filtered, "storage_error"),
    executionLatency: latency(filtered, "execution_latency"),
    reconciliationLatency: latency(filtered, "reconciliation_latency")
  };
}

export class LocalPilotTelemetry implements PilotTelemetrySink {
  readonly filePath: string;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  async record(event: PilotTelemetryRecord): Promise<void> {
    if (!isMetricName(event.name)) throw new Error(`Unsupported pilot metric: ${String(event.name)}`);
    if (
      event.durationMs !== undefined &&
      (!Number.isFinite(event.durationMs) || event.durationMs < 0)
    ) {
      throw new Error("Pilot telemetry durationMs must be a non-negative finite number");
    }
    const record: PilotTelemetryEvent = {
      name: event.name,
      recordedAt: new Date().toISOString(),
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {})
    };
    this.writeTail = this.writeTail.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    });
    await this.writeTail;
  }

  async summary(period: PilotTelemetryPeriod = {}): Promise<PilotSummary> {
    await this.writeTail;
    let content = "";
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const events = content
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseLine)
      .filter((event): event is PilotTelemetryEvent => event !== null);
    return summarizePilotTelemetry(events, period);
  }
}
