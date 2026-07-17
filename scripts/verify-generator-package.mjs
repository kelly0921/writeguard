import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = join(root, "packages", "writeguard");
const generatorDir = join(root, "packages", "generator");
const coreManifest = JSON.parse(await readFile(join(coreDir, "package.json"), "utf8"));
const generatorManifest = JSON.parse(await readFile(join(generatorDir, "package.json"), "utf8"));
const tempRoot = await mkdtemp(join(tmpdir(), "writeguard-generator-package-verify-"));
const artifactDir = join(tempRoot, "artifacts");
const appDir = join(tempRoot, "consumer");

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine(command, args)], {
          cwd,
          stdio: "inherit"
        })
      : spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)));
  });
}

const consumerSource = `import {
  analysisContractVersion,
  approveGuardGenerationReview,
  createGuardGenerationRequest,
  createGuardGenerationReviewDraft,
  normalizeMcpToolDefinition
} from "@closure/writeguard/analysis";
import {
  generateGuardedToolProject,
  generatorDescriptor,
  publishGeneratedProject,
  verifyGeneratedIntegration
} from "@closure/writeguard-generator";

const raw = {
  name: "external_write",
  description: "Create a consequential external record.",
  inputSchema: {
    type: "object",
    properties: { tenantId: { type: "string" }, recordId: { type: "string" } },
    required: ["tenantId", "recordId"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: true }
};
const tool = normalizeMcpToolDefinition(raw);
const scenario = {
  scenario: "duplicate_invocation" as const,
  expectedHandling: "suppress_duplicate" as const,
  reasoning: "Duplicate requests must converge on one external effect."
};
const analysis = {
  schemaVersion: analysisContractVersion,
  kind: "risk_analysis_result" as const,
  status: "recommendation_only" as const,
  provenance: tool.provenance,
  analyzer: { id: "external.consumer", version: "1.0.0" },
  assessment: { riskLevel: "high" as const, confidence: 0.9, summary: "Consequential write." },
  candidateOperations: [{
    id: "candidate.write",
    provenance: tool.provenance,
    displayName: "Write",
    operationKind: "external_write" as const,
    consequenceCategories: ["data_mutation" as const],
    confidence: 0.9,
    reasoning: "The tool writes an external record.",
    evidence: [{ kind: "tool_name" as const, reference: tool.tool.name }]
  }],
  proposedGuardConfigurations: [{
    id: "proposal.write",
    kind: "proposed_guard_configuration" as const,
    reviewState: "requires_developer_approval" as const,
    provenance: tool.provenance,
    candidateOperationId: "candidate.write",
    mode: "shadow" as const,
    effectType: "conditionally_reversible" as const,
    providerAdapter: { requirement: "application_hook" as const, reasoning: "Implement provider hooks." },
    operationIdentity: {
      strategy: "field_template" as const,
      template: "{tenantId}:{recordId}",
      inputFields: ["tenantId", "recordId"],
      confidence: 0.8,
      reasoning: "Stable source identifiers."
    },
    reconciliation: {
      strategy: "application_ledger" as const,
      correlationFields: [],
      expectedCardinality: "zero_or_one" as const,
      consistency: "unknown" as const,
      confidence: 0.6,
      reasoning: "Implement the real reconciliation hook."
    },
    redaction: { fieldPaths: [], reasoning: "No sensitive fields detected." },
    failureScenarios: [scenario]
  }],
  limitations: ["External consumer fixture does not prove provider semantics."]
};
const draft = createGuardGenerationReviewDraft(tool, analysis);
draft.selection.guardConfiguration.enforcementAcknowledged = true;
draft.selection.reconciliation.developerSuppliedHookAcknowledged = true;
const review = approveGuardGenerationReview({
  tool,
  analysis,
  review: draft,
  reviewer: "external-consumer",
  reviewedAt: "2026-07-17T02:30:00.000Z"
});
const request = createGuardGenerationRequest({ generator: generatorDescriptor, tool, analysis, review });
const project = generateGuardedToolProject(request);
if (!project.files.some((file) => file.path === "src/guarded-tool.ts")) throw new Error("missing wrapper");
await publishGeneratedProject(project, { outDir: "./generated" });
const staticVerification = await verifyGeneratedIntegration({ directory: "./generated" });
if (staticVerification.receipt.overallResult !== "passed_with_limitations") {
  throw new Error("static verification failed");
}
const testVerification = await verifyGeneratedIntegration({ directory: "./generated", runTests: true });
if (testVerification.receipt.checks.find((check) => check.id === "tests.generated_failure_behavior")?.status !== "passed_with_limitations") {
  throw new Error("controlled generated test verification failed");
}
if (testVerification.receipt.levels.find((level) => level.level === "real_provider_semantics")?.status !== "not_run") {
  throw new Error("real-provider semantics were overstated");
}
console.log("external generator consumer passed");
`;

try {
  await mkdir(artifactDir, { recursive: true });
  await mkdir(appDir, { recursive: true });
  await run("pnpm", ["--filter", "@closure/writeguard", "build"], root);
  await run("pnpm", ["--filter", "@closure/writeguard-generator", "build"], root);
  await run("pnpm", ["pack", "--pack-destination", artifactDir], coreDir);
  await run("pnpm", ["pack", "--pack-destination", artifactDir], generatorDir);
  const tarballs = await readdir(artifactDir);
  const coreTarball = tarballs.find((name) => name === `closure-writeguard-${coreManifest.version}.tgz`);
  const generatorTarball = tarballs.find(
    (name) => name === `closure-writeguard-generator-${generatorManifest.version}.tgz`
  );
  if (!coreTarball || !generatorTarball) {
    throw new Error(`Expected core and generator tarballs; received ${tarballs.join(", ")}`);
  }
  await writeFile(join(appDir, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  await writeFile(join(appDir, "index.ts"), consumerSource);
  await writeFile(join(appDir, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: true,
      outDir: "dist"
    },
    include: ["index.ts"]
  }, null, 2)}\n`);
  await run(
    "npm",
    ["install", "--ignore-scripts", join(artifactDir, coreTarball), join(artifactDir, generatorTarball)],
    appDir
  );
  await run(
    "node",
    [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(appDir, "tsconfig.json")],
    appDir
  );
  await run("node", [join(appDir, "dist", "index.js")], appDir);
  await run("node", [
    join(appDir, "node_modules", "@closure", "writeguard", "dist", "writeguard", "src", "cli.js"),
    "verify",
    join(appDir, "generated"),
    "--run-tests"
  ], appDir);
  const installed = JSON.parse(
    await readFile(join(appDir, "node_modules", "@closure", "writeguard-generator", "package.json"), "utf8")
  );
  const lock = await readFile(join(appDir, "package-lock.json"), "utf8");
  if (installed.dependencies?.["@closure/writeguard"] !== `^${coreManifest.version}`) {
    throw new Error("Packed generator does not declare the compatible public WriteGuard dependency");
  }
  if (lock.includes('"node_modules/openai"')) {
    throw new Error("OpenAI appeared in the generated package external-consumer dependency graph");
  }
  const result = {
    corePackage: `@closure/writeguard@${coreManifest.version}`,
    generatorPackage: `@closure/writeguard-generator@${generatorManifest.version}`,
    cleanInstall: "passed",
    declarations: "passed",
    programmaticGeneration: "passed",
    stagedPublication: "passed",
    programmaticVerification: "passed",
    packagedCliVerification: "passed",
    controlledGeneratedTests: "passed",
    realProviderSemantics: "not_run",
    openaiProductionDependency: false
  };
  await mkdir(join(root, ".writeguard"), { recursive: true });
  await writeFile(
    join(root, ".writeguard", "generator-package-verification.json"),
    `${JSON.stringify(result, null, 2)}\n`
  );
  console.log(`Generator package verification passed: ${JSON.stringify(result)}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}
