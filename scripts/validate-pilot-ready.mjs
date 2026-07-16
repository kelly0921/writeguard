import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = join(root, ".writeguard");
const writeGuardManifest = JSON.parse(
  await readFile(join(root, "packages", "writeguard", "package.json"), "utf8")
);
const ci = process.argv.includes("--ci");
const ciDatabaseUrl = process.env.PILOT_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (ci && !ciDatabaseUrl) {
  throw new Error("validate:pilot-ci requires PILOT_DATABASE_URL, TEST_DATABASE_URL, or DATABASE_URL");
}
const basePilotEnvironment = ci
  ? {
      PILOT_DATABASE_URL: ciDatabaseUrl,
      PILOT_TELEMETRY_FILE: ".writeguard/pilot-telemetry.jsonl",
      PILOT_NAMESPACE: "writeguard-pilot-ci"
    }
  : {};
const enforcedPilotEnvironment = {
  ...basePilotEnvironment,
  PILOT_MODE: "enforced",
  PILOT_PROVIDER: "fake"
};

const commands = [
  { name: "frozen Milestone 3 validation", args: ["validate:design-partner"] },
  { name: "tarball contents and exports", args: ["package:inspect"] },
  { name: "runtime dependency SBOM", args: ["security:sbom"] },
  { name: "production dependency advisory audit", args: ["security:audit"] },
  { name: "pilot sandbox start and schema", args: [ci ? "pilot:setup" : "pilot:start"], marksPilotStarted: !ci },
  {
    name: "credential-free shadow sandbox",
    args: ["pilot:validate"],
    env: { ...basePilotEnvironment, PILOT_MODE: "shadow", PILOT_PROVIDER: "fake" }
  },
  {
    name: "credential-free enforced sandbox",
    args: ["pilot:validate"],
    env: enforcedPilotEnvironment
  },
  { name: "sanitized pilot export", args: ["pilot:export"], env: enforcedPilotEnvironment },
  { name: "pilot export redaction", args: ["exec", "node", "scripts/verify-pilot-export.mjs"] },
  { name: "configuration and runtime doctor", args: ["writeguard:doctor"], env: enforcedPilotEnvironment },
  { name: "local aggregate pilot report", args: ["pilot:report"], env: enforcedPilotEnvironment },
  { name: "final repository secret scan", args: ["security:scan"] }
];

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function runPnpm(args, extraEnvironment = {}) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const environment = { ...process.env, ...extraEnvironment };
    const child = process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", commandLine("pnpm", args)],
          { cwd: root, stdio: "inherit", env: environment }
        )
      : spawn("pnpm", args, { cwd: root, stdio: "inherit", env: environment });
    child.on("error", (error) =>
      resolveRun({ passed: false, durationMs: Date.now() - startedAt, error: error.message })
    );
    child.on("exit", (code) =>
      resolveRun({
        passed: code === 0,
        durationMs: Date.now() - startedAt,
        ...(code === 0 ? {} : { error: `exit code ${code}` })
      })
    );
  });
}

const startedAt = new Date();
const checks = [];
let failed = false;
let pilotStarted = false;
for (const command of commands) {
  if (failed) {
    checks.push({ name: command.name, status: "not_run", durationMs: 0 });
    continue;
  }
  console.log(`\n[pilot-ready] ${command.name}`);
  const result = await runPnpm(command.args, command.env);
  checks.push({
    name: command.name,
    status: result.passed ? "passed" : "failed",
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {})
  });
  failed = !result.passed;
  if (result.passed && command.marksPilotStarted) pilotStarted = true;
}

if (pilotStarted) {
  console.log("\n[pilot-ready] sandbox cleanup");
  const cleanup = await runPnpm(["pilot:stop"]);
  checks.push({
    name: "sandbox cleanup",
    status: cleanup.passed ? "passed" : "failed",
    durationMs: cleanup.durationMs,
    ...(cleanup.error ? { error: cleanup.error } : {})
  });
  failed ||= !cleanup.passed;
}

const finishedAt = new Date();
const report = {
  milestone: "WriteGuard Milestone 4",
  status: failed ? "failed" : "locally_ready_for_external_pilot_operations",
  externalPilotResults: 0,
  productionCertified: false,
  sdkPackage: `@closure/writeguard@${writeGuardManifest.version}`,
  preBuildWeekBaseline: "@closure/writeguard@0.3.0",
  node: process.versions.node,
  ciMode: ci,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  checks
};
await mkdir(reportDirectory, { recursive: true });
await writeFile(join(reportDirectory, "pilot-readiness.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdown = [
  "# Local Pilot Readiness",
  "",
  `Status: **${report.status}**`,
  "",
  "Sandbox and design-partner evaluation only; not production-certified.",
  "",
  `Generated: ${finishedAt.toISOString()}`,
  `External pilot results recorded: ${report.externalPilotResults}`,
  "",
  "| Check | Status | Duration |",
  "|---|---|---:|",
  ...checks.map((check) => `| ${check.name} | ${check.status} | ${(check.durationMs / 1000).toFixed(2)}s |`),
  "",
  "This report contains validation status and duration only. It contains no operation payloads, credentials, or raw database rows."
].join("\n");
await writeFile(join(reportDirectory, "pilot-readiness.md"), `${markdown}\n`, "utf8");
console.log(`\nPilot readiness report: ${join(reportDirectory, "pilot-readiness.json")}`);
if (failed) process.exitCode = 1;
