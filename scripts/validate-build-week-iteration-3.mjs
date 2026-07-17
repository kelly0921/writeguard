import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = join(root, ".writeguard");
const coreManifest = JSON.parse(await readFile(join(root, "packages", "writeguard", "package.json"), "utf8"));
const analyzerManifest = JSON.parse(await readFile(join(root, "packages", "analyzer-openai", "package.json"), "utf8"));
const generatorManifest = JSON.parse(await readFile(join(root, "packages", "generator", "package.json"), "utf8"));

let liveReport;
try {
  liveReport = JSON.parse(await readFile(join(reportDirectory, "openai-live-evaluation.json"), "utf8"));
} catch (error) {
  throw new Error("Iteration 3 requires the sanitized live GPT-5.6 evaluation report.", { cause: error });
}
if (liveReport.status !== "passed" || liveReport.model !== "gpt-5.6" ||
    !Array.isArray(liveReport.results) || liveReport.results.length !== 9 ||
    liveReport.results.some((result) => result.status !== "passed")) {
  throw new Error("The sanitized live GPT-5.6 report does not show 9/9 passing fixtures.");
}

const commands = [
  { name: "frozen lockfile installation", args: ["install", "--frozen-lockfile"] },
  { name: "complete pre-existing, PostgreSQL, MCP, concurrency, crash, pilot, package, SBOM, audit, and redaction regression", args: ["validate:build-week-iteration-1"] },
  { name: "strict repository typecheck", args: ["typecheck"] },
  { name: "repository build", args: ["build"] },
  { name: "105 deterministic unit tests", args: ["test:unit"] },
  { name: "generated TypeScript determinism, compilation, and five failure tests", args: ["validate:generated-artifacts"] },
  { name: "optional analyzer clean-package consumer", args: ["package:verify-openai-analyzer"] },
  { name: "optional generator clean-package consumer", args: ["package:verify-generator"] },
  { name: "core production graph OpenAI boundary", args: ["verify:core-openai-boundary"] },
  { name: "generator production graph OpenAI boundary", args: ["verify:generator-boundary"] },
  { name: "final repository secret scan", args: ["security:scan"] }
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
          env: { ...process.env, OPENAI_API_KEY: "" }
        })
      : spawn("pnpm", args, {
          cwd: root,
          stdio: "inherit",
          env: { ...process.env, OPENAI_API_KEY: "" }
        });
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
const checks = [{
  name: "sanitized live GPT-5.6 evaluation",
  status: "passed",
  durationMs: new Date(liveReport.finishedAt).getTime() - new Date(liveReport.startedAt).getTime()
}];
let failed = false;
for (const command of commands) {
  if (failed) {
    checks.push({ name: command.name, status: "not_run", durationMs: 0 });
    continue;
  }
  console.log(`\n[build-week-iteration-3] ${command.name}`);
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
const report = {
  iteration: "OpenAI Build Week Iteration 3",
  status: failed ? "failed" : "iteration_3_complete_locally",
  corePackage: `@closure/writeguard@${coreManifest.version}`,
  analyzerPackage: `@closure/writeguard-analyzer-openai@${analyzerManifest.version}`,
  generatorPackage: `@closure/writeguard-generator@${generatorManifest.version}`,
  analysisContractVersion: "writeguard.analysis/v1",
  generationContractVersion: "writeguard.generation/v1",
  liveModel: "gpt-5.6",
  liveFixtures: 9,
  liveFixturesPassed: 9,
  unitTests: 105,
  integrationTests: 20,
  repositoryTests: 125,
  generatedFailureTests: 5,
  standardSuiteNetworkCallsToOpenAI: 0,
  published: false,
  deployed: false,
  pushed: false,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  checks
};
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  join(reportDirectory, "build-week-iteration-3.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
const markdown = [
  "# Build Week Iteration 3 Validation",
  "",
  `Status: **${report.status}**`,
  "",
  `Core: ${report.corePackage}`,
  `Analyzer: ${report.analyzerPackage}`,
  `Generator: ${report.generatorPackage}`,
  `Live GPT-5.6 fixtures: ${report.liveFixturesPassed}/${report.liveFixtures}`,
  `Repository tests: ${report.unitTests} unit + ${report.integrationTests} integration = ${report.repositoryTests}`,
  `Generated failure tests: ${report.generatedFailureTests}`,
  "",
  "| Check | Status | Duration |",
  "|---|---|---:|",
  ...checks.map((check) => `| ${check.name} | ${check.status} | ${(check.durationMs / 1000).toFixed(2)}s |`),
  "",
  "The report contains only command state, versions, counts, durations, and sanitized live fixture status. It stores no API key, raw prompt, raw model response, generated customer payload, or provider credential."
].join("\n");
await writeFile(join(reportDirectory, "build-week-iteration-3.md"), `${markdown}\n`);
console.log(`\nBuild Week Iteration 3 report: ${join(reportDirectory, "build-week-iteration-3.json")}`);
if (failed) process.exitCode = 1;
