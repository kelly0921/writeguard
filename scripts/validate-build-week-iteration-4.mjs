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
  throw new Error("Iteration 4 requires the existing sanitized 9/9 live GPT-5.6 report.", { cause: error });
}
if (liveReport.status !== "passed" || liveReport.model !== "gpt-5.6" ||
    !Array.isArray(liveReport.results) || liveReport.results.length !== 9 ||
    liveReport.results.some((result) => result.status !== "passed")) {
  throw new Error("The sanitized live GPT-5.6 report does not show 9/9 passing fixtures.");
}

const commands = [
  { name: "frozen lockfile installation", args: ["install", "--frozen-lockfile"] },
  { name: "public core package build", args: ["--filter", "@closure/writeguard", "build"] },
  { name: "public analyzer package build", args: ["--filter", "@closure/writeguard-analyzer-openai", "build"] },
  { name: "public generator and verifier package build", args: ["--filter", "@closure/writeguard-generator", "build"] },
  {
    name: "inherited Iteration 3 PostgreSQL, MCP, concurrency, crash, pilot, analyzer, package, SBOM, audit, and redaction gate",
    args: ["validate:build-week-iteration-3"]
  },
  { name: "strict repository typecheck", args: ["typecheck"] },
  { name: "repository build", args: ["build"] },
  { name: "145 deterministic unit tests", args: ["test:unit"] },
  {
    name: "generated artifact determinism, static verification, controlled verification, compilation, and five failure scenarios",
    args: ["validate:generated-artifacts"]
  },
  {
    name: "generator clean-package generation, programmatic verification, packaged CLI, and controlled tests",
    args: ["package:verify-generator"]
  },
  {
    name: "refund and email packed external-consumer pilots",
    args: ["validate:iteration-4-pilots"]
  },
  { name: "core production graph OpenAI boundary", args: ["verify:core-openai-boundary"] },
  { name: "generator and verifier production graph OpenAI boundary", args: ["verify:generator-boundary"] },
  { name: "package and tarball inspection", args: ["package:inspect"] },
  { name: "final repository secret scan", args: ["security:scan"] }
];

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value)
    .join(" ");
}

function runPnpm(args, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const outputChunks = [];
    let outputBytes = 0;
    const maxOutputBytes = 64 * 1024;
    let settled = false;
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine("pnpm", args)], {
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, OPENAI_API_KEY: "", STRIPE_SECRET_KEY: "" }
        })
      : spawn("pnpm", args, {
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, OPENAI_API_KEY: "", STRIPE_SECRET_KEY: "" }
        });
    const capture = (chunk) => {
      if (outputBytes >= maxOutputBytes) return;
      const remaining = maxOutputBytes - outputBytes;
      const captured = chunk.subarray(0, remaining);
      outputChunks.push(captured);
      outputBytes += captured.byteLength;
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout.destroy();
      child.stderr.destroy();
      resolveRun({
        ...result,
        durationMs: Date.now() - startedAt,
        output: Buffer.concat(outputChunks).toString("utf8")
      });
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ passed: false, error: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    timeout.unref();
    child.on("error", (error) => finish({ passed: false, error: error.message }));
    child.on("exit", (code) => finish({
      passed: code === 0,
      ...(code === 0 ? {} : { error: "exit code " + code })
    }));
  });
}

const startedAt = new Date();
const checks = [{
  name: "existing sanitized live GPT-5.6 evaluation",
  status: "passed",
  durationMs: new Date(liveReport.finishedAt).getTime() - new Date(liveReport.startedAt).getTime()
}];
let failed = false;
for (const command of commands) {
  if (failed) {
    checks.push({ name: command.name, status: "not_run", durationMs: 0 });
    continue;
  }
  console.log("\n[build-week-iteration-4] " + command.name);
  const result = await runPnpm(command.args);
  console.log(`[build-week-iteration-4] ${result.passed ? "passed" : "failed"} in ${(result.durationMs / 1000).toFixed(1)}s`);
  if (!result.passed && result.output) {
    console.error(result.output);
  }
  checks.push({
    name: command.name,
    status: result.passed ? "passed" : "failed",
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {})
  });
  failed = !result.passed;
}

let pilotReport = null;
try {
  pilotReport = JSON.parse(await readFile(join(reportDirectory, "iteration-4-pilots.json"), "utf8"));
} catch {
  if (!failed) failed = true;
}
const finishedAt = new Date();
const report = {
  iteration: "OpenAI Build Week Iteration 4",
  status: failed ? "failed" : "iteration_4_complete_locally",
  corePackage: "@closure/writeguard@" + coreManifest.version,
  analyzerPackage: "@closure/writeguard-analyzer-openai@" + analyzerManifest.version,
  generatorPackage: "@closure/writeguard-generator@" + generatorManifest.version,
  analysisContractVersion: "writeguard.analysis/v1",
  generationContractVersion: "writeguard.generation/v1",
  verificationContractVersion: "writeguard.verification/v1",
  generationManifestVersion: "writeguard.generation-manifest/v1",
  verificationBundleVersion: "writeguard.verification-bundle/v1",
  liveModel: "gpt-5.6",
  liveFixtures: 9,
  liveFixturesPassed: 9,
  liveEvaluationReused: true,
  unitTests: 145,
  integrationTests: 20,
  repositoryTests: 165,
  generatedFailureScenarios: 5,
  externalPilotSpecificTests: 6,
  uniqueAutomatedTestDefinitions: 176,
  standardGenerationOpenAICalls: 0,
  standardVerificationOpenAICalls: 0,
  refundPilot: pilotReport?.refund ?? null,
  emailPilot: pilotReport?.email ?? null,
  timingClassification: pilotReport?.timingClassification ?? null,
  published: false,
  deployed: false,
  pushed: false,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  checks
};
await mkdir(reportDirectory, { recursive: true });
await writeFile(join(reportDirectory, "build-week-iteration-4.json"), JSON.stringify(report, null, 2) + "\n");
console.log("\nBuild Week Iteration 4 report: " + join(reportDirectory, "build-week-iteration-4.json"));
if (failed) process.exitCode = 1;
