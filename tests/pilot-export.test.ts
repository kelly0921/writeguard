import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalPilotTelemetry } from "@closure/writeguard";
import { describe, expect, it } from "vitest";
import { parsePilotConfig } from "../apps/pilot-sandbox/src/config.js";
import {
  createSanitizedPilotExport,
  writeSanitizedPilotExport
} from "../apps/pilot-sandbox/src/export.js";

describe("sanitized pilot export", () => {
  it("contains only configuration categories and aggregate counters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "writeguard-export-"));
    const telemetryFile = join(directory, "telemetry.jsonl");
    const telemetry = createLocalPilotTelemetry({ filePath: telemetryFile });
    await telemetry.record({ name: "observed_operation" });
    await telemetry.record({ name: "duplicate_invocation" });
    await telemetry.record({ name: "reconciliation_latency", durationMs: 12 });
    const config = parsePilotConfig({
      PILOT_NAMESPACE: "customer-secret-id",
      PILOT_TELEMETRY_FILE: telemetryFile
    });
    const report = await createSanitizedPilotExport(config);
    expect(report.aggregates).toMatchObject({
      operationsObserved: 1,
      shadowOperations: 1,
      duplicateInvocationsObserved: 1,
      averageReconciliationLatencyMs: 12
    });
    const destination = join(directory, "pilot-export.json");
    await writeSanitizedPilotExport(config, destination);
    const serialized = await readFile(destination, "utf8");
    expect(serialized).not.toContain("customer-secret-id");
    expect(serialized).not.toContain("operationKey");
    expect(serialized).not.toContain("paymentIntent");
    expect(serialized).not.toContain("toolCallId");
    expect(serialized).not.toContain("secretKey");
    expect(serialized).toContain("namespaceHash");
  });
});
