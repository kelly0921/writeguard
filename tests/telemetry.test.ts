import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryOperationStore, UnknownExecutionOutcome } from "@writeguard/core";
import { LocalPilotTelemetry, WriteGuard } from "@writeguard/sdk";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("privacy-preserving pilot telemetry", () => {
  it("records only fixed metric names, timestamps, and durations and summarizes a guarded recovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "writeguard-telemetry-"));
    cleanup.push(directory);
    const filePath = join(directory, "pilot.jsonl");
    const telemetry = new LocalPilotTelemetry(filePath);
    const store = new InMemoryOperationStore();
    const guard = new WriteGuard({ store, namespace: "telemetry-unit", telemetry });
    const effects: Array<{ id: string; operationId: string }> = [];
    const options = {
      key: "telemetry:refund:1",
      action: { name: "refund_order", provider: "fake-payments" },
      fingerprint: { orderId: "order_1", amount: 100 },
      metadata: { customerMessage: "must never appear", cardNumber: "must never appear" },
      execute: async ({ operationId }: { operationId: string }) => {
        const result = { id: "refund_1", operationId };
        effects.push(result);
        return result;
      },
      reconcile: async ({ operationId }: { operationId: string }) => ({
        kind: "found" as const,
        result: effects.find((effect) => effect.operationId === operationId)!,
        evidence: { matchCount: 1 }
      }),
      verify: async (result: { operationId: string }, context: { operationId: string }) =>
        result.operationId === context.operationId,
      faults: { throwAfterExternalSuccess: true }
    };

    await expect(guard.execute(options)).rejects.toBeInstanceOf(UnknownExecutionOutcome);
    options.faults.throwAfterExternalSuccess = false;
    await guard.execute(options);

    const summary = await telemetry.summary();
    expect(summary).toMatchObject({
      operations: 1,
      guardedOperations: 1,
      duplicateInvocations: 1,
      unknownOutcomes: 1,
      successfulReconciliations: 1,
      suppressedExecutions: 1,
      storageErrors: 0
    });
    expect(summary.executionLatency.count).toBe(1);
    expect(summary.reconciliationLatency.count).toBe(1);

    const content = await readFile(filePath, "utf8");
    expect(content).not.toContain("customerMessage");
    expect(content).not.toContain("cardNumber");
    expect(content).not.toContain("must never appear");
    for (const line of content.trim().split(/\r?\n/)) {
      expect(Object.keys(JSON.parse(line)).sort()).toEqual(
        expect.arrayContaining(["name", "recordedAt"])
      );
      expect(Object.keys(JSON.parse(line)).every((key) => ["name", "recordedAt", "durationMs"].includes(key))).toBe(true);
    }
  });
});
