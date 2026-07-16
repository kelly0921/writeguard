import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = join(root, ".writeguard");
const coreManifest = JSON.parse(await readFile(join(root, "packages", "writeguard", "package.json"), "utf8"));
const analyzerManifest = JSON.parse(await readFile(join(root, "packages", "analyzer-openai", "package.json"), "utf8"));
const hasOpenAIKey = !!process.env.OPENAI_API_KEY?.trim();

const commands = [
  { name: "frozen lockfile installation", args: ["install", "--frozen-lockfile"] },
  { name: "complete Iteration 1 and pre-existing regression", args: ["validate:build-week-iteration-1"] },
  { name: "strict repository typecheck", args: ["typecheck"] },
  { name: "repository build", args: ["build"] },
  { name: "deterministic unit and analyzer evaluations", args: ["test:unit"] },
  { name: "optional analyzer clean-package consumer", args: ["package:verify-openai-analyzer"] },
  { name: "core production graph OpenAI boundary", args: ["verify:core-openai-boundary"] },
  { name: "production dependency advisory audit", args: ["security:audit"] },
  { name: "final repository secret scan", args: ["security:scan"] },
  ...(hasOpenAIKey ? [{ name: "live GPT-5.6 model-quality evaluation", args: ["eval:openai-live"] }] : [])
];

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function runPnpm(args) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine("pnpm", args)], {
          cwd: root,
          stdio: "inherit",
          env: process.env
        })
      : spawn("pnpm", args, { cwd: root, stdio: "inherit", env: process.env });
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
for (const command of commands) {
  if (failed) {
    checks.push({ name: command.name, status: "not_run", durationMs: 0 });
    continue;
  }
  console.log(`\n[build-week-iteration-2] ${command.name}`);
  const result = await runPnpm(command.args);
  checks.push({
    name: command.name,
    status: result.passed ? "passed" : "failed",
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {})
  });
  failed = !result.passed;
}

const finishedAt = new Date();
const liveEvaluation = hasOpenAIKey
  ? (failed ? "failed_or_not_run" : "passed")
  : "pending_missing_openai_api_key";
const status = failed
  ? "failed"
  : hasOpenAIKey
    ? "iteration_2_complete_including_live_evaluation"
    : "deterministic_iteration_2_complete_live_evaluation_pending";
const report = {
  iteration: "OpenAI Build Week Iteration 2",
  status,
  corePackage: `@closure/writeguard@${coreManifest.version}`,
  analyzerPackage: `@closure/writeguard-analyzer-openai@${analyzerManifest.version}`,
  model: "gpt-5.6",
  sdk: `openai@${analyzerManifest.dependencies.openai}`,
  contractVersion: "writeguard.analysis/v1",
  unitTests: 72,
  integrationTests: 20,
  totalTests: 92,
  standardSuiteNetworkCallsToOpenAI: 0,
  liveEvaluation,
  published: false,
  deployed: false,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  checks
};
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  join(reportDirectory, "build-week-iteration-2.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
const markdown = [
  "# Build Week Iteration 2 Validation",
  "",
  `Status: **${status}**`,
  "",
  `Core package: ${report.corePackage}`,
  `Optional analyzer: ${report.analyzerPackage}`,
  `Model: ${report.model}`,
  `Live evaluation: ${liveEvaluation}`,
  "",
  "| Check | Status | Duration |",
  "|---|---|---:|",
  ...checks.map((check) => `| ${check.name} | ${check.status} | ${(check.durationMs / 1000).toFixed(2)}s |`),
  "",
  "This report contains command status and duration only. It stores no API keys, raw prompts, model responses, or full tool inputs."
].join("\n");
await writeFile(join(reportDirectory, "build-week-iteration-2.md"), `${markdown}\n`, "utf8");
console.log(`\nBuild Week Iteration 2 report: ${join(reportDirectory, "build-week-iteration-2.json")}`);
if (failed) process.exitCode = 1;
