import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = join(root, ".writeguard");
const packageAt = async (name) => JSON.parse(
  await readFile(join(root, "packages", name, "package.json"), "utf8")
);
const core = await packageAt("writeguard");
const analyzer = await packageAt("analyzer-openai");
const generator = await packageAt("generator");
const live = JSON.parse(
  await readFile(join(reportDirectory, "openai-live-evaluation.json"), "utf8")
);
if (
  live.status !== "passed" ||
  live.model !== "gpt-5.6" ||
  live.results?.length !== 9 ||
  live.results.some((result) => result.status !== "passed")
) {
  throw new Error("Iteration 5 requires the existing sanitized 9/9 GPT-5.6 evaluation report.");
}

const commands = [
  ["frozen lockfile installation", ["install", "--frozen-lockfile"]],
  ["public core package build", ["--filter", "@closure/writeguard", "build"]],
  ["public analyzer package build", ["--filter", "@closure/writeguard-analyzer-openai", "build"]],
  ["public generator package build", ["--filter", "@closure/writeguard-generator", "build"]],
  ["complete inherited Iteration 4 regression gate", ["validate:build-week-iteration-4"]],
  ["171 deterministic unit tests", ["test:unit"]],
  ["canonical zero-credential clean-consumer evaluation", ["evaluate:local"]],
  ["evaluation CI example structural validation", ["validate:evaluation-ci"]],
  ["documentation path, credential, and canonical-command hygiene", ["docs:scan"]],
  ["final repository secret scan", ["security:scan"]]
];

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function runPnpm(args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const maximum = 96 * 1024;
    const environment = {
      ...process.env,
      OPENAI_API_KEY: "",
      STRIPE_SECRET_KEY: ""
    };
    const child = process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", commandLine("pnpm", args)],
          { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: environment }
        )
      : spawn("pnpm", args, {
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
          env: environment
        });
    const capture = (chunk) => {
      if (bytes >= maximum) return;
      const next = chunk.subarray(0, maximum - bytes);
      chunks.push(next);
      bytes += next.byteLength;
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const finish = (passed, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveRun({
        passed,
        durationMs: Date.now() - started,
        output: Buffer.concat(chunks).toString("utf8"),
        ...(error ? { error } : {})
      });
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false, `timed out after ${timeoutMs} ms`);
    }, timeoutMs);
    timeout.unref();
    child.on("error", (error) => finish(false, error.message));
    child.on("exit", (code) => finish(code === 0, code === 0 ? undefined : `exit code ${code}`));
  });
}

const startedAt = new Date();
const checks = [{
  name: "existing sanitized live GPT-5.6 evaluation",
  status: "passed",
  durationMs: new Date(live.finishedAt).getTime() - new Date(live.startedAt).getTime()
}];
let failed = false;
for (const [name, args] of commands) {
  if (failed) {
    checks.push({ name, status: "not_run", durationMs: 0 });
    continue;
  }
  console.log(`\n[build-week-iteration-5] ${name}`);
  const result = await runPnpm(args);
  console.log(
    `[build-week-iteration-5] ${result.passed ? "passed" : "failed"} in ` +
    `${(result.durationMs / 1000).toFixed(1)}s`
  );
  if (!result.passed && result.output) console.error(result.output);
  checks.push({
    name,
    status: result.passed ? "passed" : "failed",
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {})
  });
  failed = !result.passed;
}

let evaluation = null;
try {
  evaluation = JSON.parse(
    await readFile(join(reportDirectory, "evaluation-report.json"), "utf8")
  );
} catch {
  failed = true;
}
const finishedAt = new Date();
const report = {
  iteration: "OpenAI Build Week Iteration 5",
  status: failed ? "failed" : "evaluation_release_candidate_complete_locally",
  packages: {
    core: `@closure/writeguard@${core.version}`,
    analyzer: `@closure/writeguard-analyzer-openai@${analyzer.version}`,
    generator: `@closure/writeguard-generator@${generator.version}`
  },
  contracts: {
    analysis: "writeguard.analysis/v1",
    generation: "writeguard.generation/v1",
    verification: "writeguard.verification/v1",
    verificationPolicy: "writeguard.verification-policy/v1",
    policyEvaluation: "writeguard.verification-policy-evaluation/v1",
    adapterConformance: "writeguard.adapter-conformance/v1",
    localEvaluation: "writeguard.local-evaluation/v1"
  },
  unitTests: 171,
  integrationTests: 20,
  repositoryTests: 191,
  generatedFailureScenarios: 5,
  adapterConformanceScenarios: 6,
  liveModelEvaluation: { model: "gpt-5.6", passed: 9, total: 9, reused: true },
  canonicalEvaluation: evaluation,
  stripeTestModeConformance: "pending_no_fresh_secure_key",
  licenseDecision: "pending_owner_decision",
  published: false,
  deployed: false,
  pushed: false,
  submitted: false,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  checks
};
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  join(reportDirectory, "build-week-iteration-5.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(`\nBuild Week Iteration 5 report: ${join(reportDirectory, "build-week-iteration-5.json")}`);
if (failed) process.exitCode = 1;
