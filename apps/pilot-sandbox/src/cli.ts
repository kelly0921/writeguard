import { dirname } from "node:path";
import { loadPilotConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { writePilotReport, writeSanitizedPilotExport } from "./export.js";
import { runFakePilotScenario } from "./runner.js";
import { resetPilotState, setupPilotState } from "./state.js";
import { runStripePilotScenario } from "./stripe-runner.js";

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/sk_(?:test|live)_[A-Za-z0-9_-]+/g, "[REDACTED_STRIPE_KEY]");
}

const command = process.argv[2] ?? "help";

try {
  const config = loadPilotConfig({ requireLocalDatabase: true });
  switch (command) {
    case "setup": {
      await setupPilotState(config);
      console.log(
        `Pilot schema ready: mode=${config.mode}, provider=${config.provider}, telemetry=${config.telemetryEnabled ? "enabled" : "disabled"}.`
      );
      break;
    }
    case "reset": {
      await resetPilotState(config);
      console.log("Pilot database rows and local pilot artifacts reset deterministically.");
      break;
    }
    case "validate": {
      await resetPilotState(config);
      const result = config.provider === "fake"
        ? await runFakePilotScenario(config)
        : await runStripePilotScenario(config);
      if (result.provider === "fake") {
        if (result.mode === "shadow" && result.externalEffects !== 2) {
          throw new Error("Shadow validation expected two uncontrolled fake effects.");
        }
        if (result.mode === "enforced" && (result.externalEffects !== 1 || result.finalStatus !== "CONFIRMED")) {
          throw new Error("Enforced validation expected one reconciled fake effect and a CONFIRMED receipt.");
        }
      } else if (!result.sameReceiptReturned || result.finalStatus !== "CONFIRMED") {
        throw new Error("Stripe test validation did not return one stable CONFIRMED receipt.");
      }
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "report": {
      const destination = await writePilotReport(config);
      console.log(`Sanitized local pilot report written under ${dirname(destination)}. Inspect before sharing.`);
      break;
    }
    case "export": {
      const destination = await writeSanitizedPilotExport(config);
      console.log(`Sanitized aggregate export written under ${dirname(destination)}. No data was uploaded.`);
      break;
    }
    case "doctor": {
      const report = await runDoctor(config);
      for (const check of report.checks) {
        console.log(`${check.status === "passed" ? "PASS" : "FAIL"}  ${check.name}: ${check.message}`);
      }
      if (report.status === "failed") process.exitCode = 1;
      break;
    }
    default:
      console.log("Commands: setup, validate, report, export, reset, doctor");
      if (command !== "help") process.exitCode = 1;
  }
} catch (error) {
  console.error(`Pilot command failed: ${safeError(error)}`);
  process.exitCode = 1;
}
