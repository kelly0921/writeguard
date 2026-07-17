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
const coreDir = join(root, "packages", "writeguard");
const generatorDir = join(root, "packages", "generator");
const coreManifest = JSON.parse(await readFile(join(coreDir, "package.json"), "utf8"));
const generatorManifest = JSON.parse(await readFile(join(generatorDir, "package.json"), "utf8"));
const tempRoot = await mkdtemp(join(tmpdir(), "writeguard-iteration-4-pilots-"));
const artifacts = join(tempRoot, "artifacts");
const reportDirectory = join(root, ".writeguard");
const maxOutputBytes = 2 * 1024 * 1024;

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value)
    .join(" ");
}

function run(command, args, cwd, options = {}) {
  return new Promise((resolveRun, reject) => {
    const startedAt = Date.now();
    const child = process.platform === "win32" && command !== process.execPath
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine(command, args)], {
          cwd,
          stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
          env: options.env ?? process.env
        })
      : spawn(command, args, {
          cwd,
          stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
          env: options.env ?? process.env
        });
    let stdout = "";
    let stderr = "";
    const capture = (target, chunk) => {
      const current = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
      const remaining = Math.max(0, maxOutputBytes - current);
      const text = chunk.subarray(0, remaining).toString("utf8");
      if (target === "stdout") stdout += text;
      else stderr += text;
      if (current + chunk.byteLength > maxOutputBytes) child.kill("SIGKILL");
    };
    child.stdout?.on("data", (chunk) => capture("stdout", chunk));
    child.stderr?.on("data", (chunk) => capture("stderr", chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      const result = { code, stdout, stderr, durationMs: Date.now() - startedAt };
      if (code === 0) resolveRun(result);
      else reject(new Error(command + " " + args.join(" ") + " exited with " + code + ": " + stderr.slice(0, 500)));
    });
  });
}

async function assertExternalSources(directory) {
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "generated") continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      const content = await readFile(path, "utf8");
      if (content.includes("workspace:") || content.includes("packages/writeguard/src") ||
          content.includes("packages/generator/src") || content.includes("../../packages/")) {
        throw new Error("External pilot contains a workspace or private-source dependency: " + path);
      }
      if (/sk_(?:test|live)_[A-Za-z0-9]{12,}|sk-proj-[A-Za-z0-9_-]{12,}/.test(content)) {
        throw new Error("External pilot contains a credential-shaped value: " + path);
      }
    }
  }
  await visit(directory);
}

function assertReceipt(run, label, testsExpected) {
  if (run.receipt?.schemaVersion !== "writeguard.verification/v1") {
    throw new Error(label + " did not produce a supported verification receipt");
  }
  if (run.receipt.overallResult !== "passed_with_limitations") {
    throw new Error(label + " verification did not pass with honest limitations");
  }
  const realProvider = run.receipt.levels.find((level) => level.level === "real_provider_semantics");
  if (realProvider?.status !== "not_run") {
    throw new Error(label + " incorrectly claimed real-provider verification");
  }
  const generatedTests = run.receipt.checks.find((check) => check.id === "tests.generated_failure_behavior");
  if (testsExpected && generatedTests?.status !== "passed_with_limitations") {
    throw new Error(label + " controlled generated tests did not pass");
  }
  if (!testsExpected && generatedTests?.status !== "not_run") {
    throw new Error(label + " static verification unexpectedly executed generated code");
  }
  const serialized = JSON.stringify(run);
  if (/sk_(?:test|live)_[A-Za-z0-9]{12,}|sk-proj-[A-Za-z0-9_-]{12,}/.test(serialized)) {
    throw new Error(label + " receipt contains credential-shaped output");
  }
}

async function validatePilot(config, coreTarball, generatorTarball) {
  const startedAt = Date.now();
  const consumer = join(tempRoot, config.directoryName);
  await cp(join(root, "fixtures", config.fixtureName), consumer, { recursive: true });
  await assertExternalSources(consumer);
  const install = await run(
    "npm",
    ["install", "--ignore-scripts", join(artifacts, coreTarball), join(artifacts, generatorTarball)],
    consumer
  );
  const lock = await readFile(join(consumer, "package-lock.json"), "utf8");
  if (lock.includes('"node_modules/openai"')) {
    throw new Error(config.label + " clean consumer unexpectedly installed OpenAI");
  }
  const setup = await run(process.execPath, [join(consumer, "src", "setup.mjs")], consumer, { capture: true });
  const setupResult = JSON.parse(setup.stdout);
  if (setupResult.liveOpenAICalls !== 0) throw new Error(config.label + " setup reported an OpenAI call");

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
  const staticRun = await run(process.execPath, [
    cli,
    "verify",
    "generated",
    "--provider-file",
    config.providerFile,
    "--strict"
  ], consumer, { capture: true, env: { ...process.env, OPENAI_API_KEY: "", STRIPE_SECRET_KEY: "" } });
  const staticReceipt = JSON.parse(staticRun.stdout);
  assertReceipt(staticReceipt, config.label + " static", false);

  const testRun = await run(process.execPath, [
    cli,
    "verify",
    "generated",
    "--provider-file",
    config.providerFile,
    "--strict",
    "--run-tests"
  ], consumer, { capture: true, env: { ...process.env, OPENAI_API_KEY: "", STRIPE_SECRET_KEY: "" } });
  const testReceipt = JSON.parse(testRun.stdout);
  assertReceipt(testReceipt, config.label + " generated tests", true);
  if (!testRun.stderr.includes("not a security sandbox")) {
    throw new Error(config.label + " opt-in execution did not disclose the child-process boundary");
  }

  const compiler = join(consumer, "node_modules", "typescript", "lib", "tsc.js");
  const compilation = await run(process.execPath, [compiler, "-p", join(consumer, "tsconfig.json")], consumer);
  const pilotTest = await run(process.execPath, ["--test", join(consumer, "dist", "pilot-test", config.testFile)], consumer);
  const review = JSON.parse(await readFile(join(consumer, "artifacts", "approved-review.json"), "utf8"));
  const receiptPath = join(reportDirectory, config.receiptName);
  await writeFile(receiptPath, JSON.stringify(testReceipt, null, 2) + "\n");
  return {
    label: config.label,
    status: "passed",
    packedPublicPackages: true,
    privateImports: false,
    openAICalls: 0,
    staticVerification: "passed_with_limitations",
    controlledGeneratedTests: "passed_with_limitations",
    realProviderSemantics: "not_run",
    identityFields: review.selection.operationIdentity.inputFields,
    redactionFields: review.selection.redactionFields,
    pilotSpecificTests: 3,
    receiptPath,
    timings: {
      installMs: install.durationMs,
      setupMs: setup.durationMs,
      staticVerificationMs: staticRun.durationMs,
      generatedTestVerificationMs: testRun.durationMs,
      pilotCompilationMs: compilation.durationMs,
      pilotTestsMs: pilotTest.durationMs,
      automatedTotalMs: Date.now() - startedAt
    }
  };
}

try {
  await mkdir(artifacts, { recursive: true });
  await mkdir(reportDirectory, { recursive: true });
  await run("pnpm", ["--filter", "@closure/writeguard", "build"], root);
  await run("pnpm", ["--filter", "@closure/writeguard-generator", "build"], root);
  await run("pnpm", ["pack", "--pack-destination", artifacts], coreDir);
  await run("pnpm", ["pack", "--pack-destination", artifacts], generatorDir);
  const packed = await readdir(artifacts);
  const coreTarball = packed.find((name) => name === "closure-writeguard-" + coreManifest.version + ".tgz");
  const generatorTarball = packed.find(
    (name) => name === "closure-writeguard-generator-" + generatorManifest.version + ".tgz"
  );
  if (!coreTarball || !generatorTarball) throw new Error("Expected core and generator tarballs were not created");

  const refund = await validatePilot({
    label: "refund",
    fixtureName: "iteration-4-refund-pilot",
    directoryName: "refund-consumer",
    providerFile: "provider/simulated-refund.ts",
    testFile: "refund.test.js",
    receiptName: "iteration-4-refund-verification.json"
  }, coreTarball, generatorTarball);
  const email = await validatePilot({
    label: "email",
    fixtureName: "iteration-4-email-pilot",
    directoryName: "email-consumer",
    providerFile: "provider/simulated-email.ts",
    testFile: "email.test.js",
    receiptName: "iteration-4-email-verification.json"
  }, coreTarball, generatorTarball);

  if (JSON.stringify(refund.identityFields) === JSON.stringify(email.identityFields)) {
    throw new Error("Refund and email pilots unexpectedly use the same operation identity policy");
  }
  if (!email.redactionFields.includes("recipientEmail") ||
      !email.redactionFields.includes("subject") ||
      !email.redactionFields.includes("body")) {
    throw new Error("Email pilot did not preserve approved sensitive-field redaction");
  }
  const report = {
    status: "passed",
    packages: {
      core: "@closure/writeguard@" + coreManifest.version,
      generator: "@closure/writeguard-generator@" + generatorManifest.version
    },
    refund,
    email,
    timingClassification: {
      automatedExecution: {
        status: "measured",
        refundMs: refund.timings.automatedTotalMs,
        emailMs: email.timings.automatedTotalMs,
        limitation: "Automation duration is not user onboarding time."
      },
      maintainerCleanRoom: {
        status: "pending_manual_measurement",
        limitation: "No manual maintainer stopwatch claim is inferred from automation."
      },
      externalDeveloper: {
        status: "pending_external_developer",
        limitation: "The under-ten-minute customer outcome is not yet externally validated."
      }
    },
    published: false,
    deployed: false,
    pushed: false
  };
  await writeFile(join(reportDirectory, "iteration-4-pilots.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("Iteration 4 external-consumer pilots passed: " + JSON.stringify(report));
} finally {
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}
