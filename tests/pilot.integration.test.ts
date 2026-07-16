import { beforeEach, describe, expect, it } from "vitest";
import { parsePilotConfig } from "../apps/pilot-sandbox/src/config.js";
import { runDoctor } from "../apps/pilot-sandbox/src/doctor.js";
import { runFakePilotScenario } from "../apps/pilot-sandbox/src/runner.js";
import { resetPilotState } from "../apps/pilot-sandbox/src/state.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

function config(mode: "shadow" | "enforced") {
  return parsePilotConfig({
    PILOT_MODE: mode,
    PILOT_DATABASE_URL: databaseUrl,
    PILOT_NAMESPACE: `pilot-test-${mode}`,
    PILOT_TELEMETRY_FILE: `.tmp/pilot-${mode}-${Date.now()}.jsonl`
  }, { requireLocalDatabase: true });
}

integration("external pilot sandbox", () => {
  beforeEach(async () => {
    await resetPilotState(config("shadow"));
  });

  it("observes duplicate uncontrolled writes without suppressing them in shadow mode", async () => {
    const result = await runFakePilotScenario(config("shadow"));
    expect(result).toMatchObject({
      mode: "shadow",
      externalEffects: 2,
      finalStatus: "ambiguous_matches",
      duplicateBehavior: "observed_not_suppressed",
      supportCase: { status: "OPEN", refundStatus: "NOT_REQUESTED", hasReceipt: false }
    });
  });

  it("reconciles acknowledgement loss without a second effect in enforced mode", async () => {
    const result = await runFakePilotScenario(config("enforced"));
    expect(result).toMatchObject({
      mode: "enforced",
      externalEffects: 1,
      finalStatus: "CONFIRMED",
      duplicateBehavior: "reconciled_and_suppressed",
      supportCase: { status: "RESOLVED", refundStatus: "CONFIRMED", hasReceipt: true }
    });
  });

  it("doctor verifies migrations, storage, receipt creation, and reconciliation", async () => {
    const doctorConfig = config("shadow");
    const report = await runDoctor(doctorConfig);
    expect(report.status).toBe("passed");
    expect(report.checks.filter((check) => check.status === "failed")).toEqual([]);
  });
});
