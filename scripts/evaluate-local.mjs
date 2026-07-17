import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "fixtures", "evaluation-release-candidate");
const reportDirectory = join(root, ".writeguard");
const coreDirectory = join(root, "packages", "writeguard");
const generatorDirectory = join(root, "packages", "generator");
const coreManifest = JSON.parse(await readFile(join(coreDirectory, "package.json"), "utf8"));
const generatorManifest = JSON.parse(await readFile(join(generatorDirectory, "package.json"), "utf8"));
const temporaryRoot = await mkdtemp(join(tmpdir(), "writeguard-evaluate-local-"));
const consumer = join(temporaryRoot, "consumer");
const packedArtifacts = join(temporaryRoot, "packages");
const npmCache = join(temporaryRoot, "npm-cache");
const maxOutputBytes = 2 * 1024 * 1024;
const startedAt = Date.now();
let installDurationMs = 0;

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function selectedEnvironment(overrides = {}) {
  const selected = {};
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "ComSpec",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)"
  ]) {
    if (process.env[key]) selected[key] = process.env[key];
  }
  return {
    ...selected,
    OPENAI_API_KEY: "",
    STRIPE_SECRET_KEY: "",
    DATABASE_URL: "",
    TEST_DATABASE_URL: "",
    PILOT_DATABASE_URL: "",
    NODE_OPTIONS: "",
    ...overrides
  };
}

function sanitize(value) {
  return String(value)
    .replaceAll(root, "<workspace>")
    .replaceAll(temporaryRoot, "<temporary-consumer>")
    .replace(
      /sk_(?:test|live)_[A-Za-z0-9]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}/g,
      "[REDACTED]"
    );
}

function run(command, args, cwd, options = {}) {
  return new Promise((resolveRun, reject) => {
    const started = Date.now();
    const child = process.platform === "win32" && command !== process.execPath
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", commandLine(command, args)],
          {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: options.env ?? selectedEnvironment()
          }
        )
      : spawn(command, args, {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: options.env ?? selectedEnvironment()
        });
    let stdout = "";
    let stderr = "";
    let outputLimited = false;
    const capture = (target, chunk) => {
      const current = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
      if (current >= maxOutputBytes) {
        outputLimited = true;
        child.kill("SIGKILL");
        return;
      }
      const text = chunk.subarray(0, maxOutputBytes - current).toString("utf8");
      if (target === "stdout") stdout += text;
      else stderr += text;
    };
    child.stdout.on("data", (chunk) => capture("stdout", chunk));
    child.stderr.on("data", (chunk) => capture("stderr", chunk));
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${options.timeoutMs ?? 120_000} ms`));
    }, options.timeoutMs ?? 120_000);
    timeout.unref();
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      const result = {
        code,
        stdout,
        stderr,
        durationMs: Date.now() - started
      };
      if (code === 0 && !outputLimited) resolveRun(result);
      else {
        reject(new Error(
          `${command} ${args.join(" ")} failed: ${
            outputLimited ? "output limit exceeded" : stderr || stdout || `exit ${code}`
          }`
        ));
      }
    });
  });
}

async function assertFixtureSources(directory) {
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (["node_modules", "dist", "generated", "artifacts"].includes(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      const content = await readFile(path, "utf8");
      if (
        content.includes("workspace:") ||
        content.includes("packages/writeguard/src") ||
        content.includes("packages/generator/src") ||
        content.includes("../../packages/")
      ) {
        throw new Error(`Evaluation fixture contains a workspace or private-source dependency: ${entry.name}`);
      }
      if (
        /sk_(?:test|live)_[A-Za-z0-9]{12,}|sk-proj-[A-Za-z0-9_-]{12,}/.test(content)
      ) {
        throw new Error(`Evaluation fixture contains a credential-shaped value: ${entry.name}`);
      }
      if (
        /(?:from\s*|import\s*)["'](?:node:)?(?:http|https|net|tls|dgram|undici|openai|stripe)["']/
          .test(content)
      ) {
        throw new Error(`Evaluation fixture contains a post-install network import: ${entry.name}`);
      }
    }
  }
  await visit(directory);
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not emit one valid JSON value`, { cause: error });
  }
}

function assertSanitizedEvidence(value, label) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (
    /sk_(?:test|live)_[A-Za-z0-9]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}/
      .test(serialized)
  ) {
    throw new Error(`${label} contains a credential-shaped value`);
  }
  if (/[A-Za-z]:\\Users\\|\/Users\/[^/\s]+\/|file:\/\//i.test(serialized)) {
    throw new Error(`${label} contains an absolute user path`);
  }
}

async function writeConsumerArtifact(name, value) {
  await writeFile(
    join(consumer, "artifacts", name),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

function stage(label) {
  process.stderr.write(`[writeguard evaluation] ${label}\n`);
}

try {
  await mkdir(packedArtifacts, { recursive: true });
  await mkdir(npmCache, { recursive: true });
  await mkdir(reportDirectory, { recursive: true });
  await cp(fixture, consumer, { recursive: true });
  await assertFixtureSources(consumer);

  stage("build and pack public packages");
  await run("pnpm", ["--filter", "@closure/writeguard", "build"], root);
  await run("pnpm", ["--filter", "@closure/writeguard-generator", "build"], root);
  await run("pnpm", ["pack", "--pack-destination", packedArtifacts], coreDirectory);
  await run("pnpm", ["pack", "--pack-destination", packedArtifacts], generatorDirectory);
  const packed = await readdir(packedArtifacts);
  const coreTarball = packed.find(
    (name) => name === `closure-writeguard-${coreManifest.version}.tgz`
  );
  const generatorTarball = packed.find(
    (name) => name === `closure-writeguard-generator-${generatorManifest.version}.tgz`
  );
  if (!coreTarball || !generatorTarball) {
    throw new Error("Expected packed public package artifacts were not created.");
  }

  stage("install packed packages in a clean consumer");
  const install = await run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      join(packedArtifacts, coreTarball),
      join(packedArtifacts, generatorTarball)
    ],
    consumer,
    {
      env: selectedEnvironment({
        npm_config_cache: npmCache,
        npm_config_update_notifier: "false"
      }),
      timeoutMs: 300_000
    }
  );
  installDurationMs = install.durationMs;
  const lock = await readFile(join(consumer, "package-lock.json"), "utf8");
  if (
    lock.includes('"node_modules/openai"') ||
    lock.includes('"node_modules/stripe"') ||
    lock.includes('"workspace:')
  ) {
    throw new Error("The clean evaluation consumer installed a forbidden runtime dependency.");
  }

  const offlineEnvironment = selectedEnvironment({
    npm_config_offline: "true",
    WRITEGUARD_EVALUATION_NETWORK: "disabled"
  });
  stage("normalize, validate recorded analysis, approve, and generate");
  const setupRun = await run(
    process.execPath,
    [join(consumer, "src", "setup.mjs")],
    consumer,
    { env: offlineEnvironment }
  );
  const setup = parseJsonOutput(setupRun, "evaluation setup");
  await writeConsumerArtifact("setup-result.json", setup);
  if (
    setup.analysis?.source !== "recorded_fixture" ||
    setup.analysis?.liveCall !== false ||
    setup.analysis?.status !== "recommendation_only" ||
    setup.developerApproval?.state !== "approved" ||
    setup.developerApproval?.approvalWasInferred !== false
  ) {
    throw new Error("The recorded-analysis or explicit-approval evidence is invalid.");
  }

  const cli = join(
    consumer,
    "node_modules",
    "@closure",
    "writeguard",
    "dist",
    "writeguard",
    "src",
    "cli.js"
  );
  stage("run safe static verification");
  const staticRun = await run(process.execPath, [
    cli,
    "verify",
    "generated",
    "--provider-file",
    "provider/simulated-refund.ts",
    "--strict"
  ], consumer, { env: offlineEnvironment });
  const staticVerification = parseJsonOutput(staticRun, "static verification");
  await writeConsumerArtifact("static-verification.json", staticVerification);
  if (
    staticVerification.receipt?.overallResult !== "passed_with_limitations" ||
    staticVerification.receipt?.checks?.find(
      (check) => check.id === "tests.generated_failure_behavior"
    )?.status !== "not_run"
  ) {
    throw new Error("Safe static verification did not preserve the no-execution boundary.");
  }

  stage("explicitly execute manifest-owned generated tests");
  const testRun = await run(process.execPath, [
    cli,
    "verify",
    "generated",
    "--provider-file",
    "provider/simulated-refund.ts",
    "--strict",
    "--run-tests"
  ], consumer, { env: offlineEnvironment });
  const generatedTestVerification = parseJsonOutput(testRun, "generated-test verification");
  await writeConsumerArtifact("generated-test-verification.json", generatedTestVerification);
  if (
    generatedTestVerification.receipt?.checks?.find(
      (check) => check.id === "tests.generated_failure_behavior"
    )?.status !== "passed_with_limitations" ||
    generatedTestVerification.receipt?.levels?.find(
      (level) => level.level === "real_provider_semantics"
    )?.status !== "not_run" ||
    !testRun.stderr.includes("not a security sandbox")
  ) {
    throw new Error("Controlled generated-test verification evidence is invalid.");
  }

  stage("evaluate the CI receipt policy");
  const policyRun = await run(process.execPath, [
    cli,
    "policy",
    "check",
    "artifacts/generated-test-verification.json",
    "--policy",
    "writeguard.policy.json"
  ], consumer, { env: offlineEnvironment });
  const policyEvaluation = parseJsonOutput(policyRun, "policy evaluation");
  await writeConsumerArtifact("policy-evaluation.json", policyEvaluation);
  if (policyEvaluation.overallResult !== "passed") {
    throw new Error("The evaluation receipt did not satisfy the release-candidate CI policy.");
  }

  stage("compile the consumer with public package declarations");
  const compiler = join(consumer, "node_modules", "typescript", "lib", "tsc.js");
  await run(
    process.execPath,
    [compiler, "-p", join(consumer, "tsconfig.json")],
    consumer,
    { env: offlineEnvironment }
  );

  stage("observe unsafe and guarded simulated effects");
  const tourRun = await run(
    process.execPath,
    [join(consumer, "dist", "src", "tour.js")],
    consumer,
    { env: offlineEnvironment }
  );
  const tour = parseJsonOutput(tourRun, "effect tour");
  await writeConsumerArtifact("tour-result.json", tour);
  if (
    tour.unsafeExternalEffects !== 2 ||
    tour.guardedExternalEffects !== 1 ||
    tour.duplicateExecutionPrevented !== true
  ) {
    throw new Error("The unsafe-versus-guarded effect demonstration failed.");
  }

  stage("run the public six-scenario adapter conformance workflow");
  const conformanceRun = await run(
    process.execPath,
    [join(consumer, "dist", "src", "adapter-conformance.js")],
    consumer,
    { env: offlineEnvironment }
  );
  const adapterConformance = parseJsonOutput(conformanceRun, "adapter conformance");
  await writeConsumerArtifact("adapter-conformance.json", adapterConformance);
  if (
    adapterConformance.overallResult !== "passed" ||
    adapterConformance.provider?.environment !== "simulated" ||
    adapterConformance.scenarios?.length !== 6
  ) {
    throw new Error("The public adapter conformance receipt is incomplete.");
  }

  stage("render one receipt-derived evaluation report");
  const reportRun = await run(
    process.execPath,
    [join(consumer, "src", "report.mjs")],
    consumer,
    { env: offlineEnvironment }
  );
  const rendered = parseJsonOutput(reportRun, "evaluation report");
  if (
    rendered.report?.effects?.unsafeExternalEffects !== 2 ||
    rendered.report?.effects?.guardedExternalEffects !== 1 ||
    rendered.report?.policy?.overallResult !== "passed" ||
    rendered.report?.adapterConformance?.overallResult !== "passed"
  ) {
    throw new Error("The final evaluation report is missing required evidence.");
  }
  assertSanitizedEvidence(rendered.report, "evaluation report");
  assertSanitizedEvidence(rendered.summary, "evaluation summary");

  const totalDurationMs = Date.now() - startedAt;
  const humanSummary = `${rendered.summary}\nAutomated command runtime: ${(
    totalDurationMs / 1000
  ).toFixed(1)} seconds. This is not developer onboarding time.\n`;
  await writeFile(
    join(reportDirectory, "evaluation-report.json"),
    `${JSON.stringify({
      report: rendered.report,
      reportDigest: rendered.reportDigest
    }, null, 2)}\n`
  );
  await writeFile(join(reportDirectory, "evaluation-summary.md"), humanSummary);
  await writeFile(
    join(reportDirectory, "evaluation-static-verification.json"),
    `${JSON.stringify(staticVerification, null, 2)}\n`
  );
  await writeFile(
    join(reportDirectory, "evaluation-generated-test-verification.json"),
    `${JSON.stringify(generatedTestVerification, null, 2)}\n`
  );
  await writeFile(
    join(reportDirectory, "evaluation-policy.json"),
    `${JSON.stringify(policyEvaluation, null, 2)}\n`
  );
  await writeFile(
    join(reportDirectory, "evaluation-adapter-conformance.json"),
    `${JSON.stringify(adapterConformance, null, 2)}\n`
  );
  await writeFile(
    join(reportDirectory, "evaluation-runtime.json"),
    `${JSON.stringify({
      classification: "automated_execution",
      durationMs: totalDurationMs,
      installDurationMs,
      onboardingTime: false,
      postInstallNetworkCalls: 0,
      openAICalls: 0,
      stripeCalls: 0,
      postgresqlRequired: false
    }, null, 2)}\n`
  );
  process.stdout.write(humanSummary);
} catch (error) {
  process.stderr.write(`[writeguard evaluation] failed: ${sanitize(
    error instanceof Error ? error.message : error
  )}\n`);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
}
