import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import {
  analysisContractVersion,
  analyzerDescriptorSchema,
  digestAnalysisArtifact,
  generationContractVersion,
  generatorDescriptorSchema,
  guardGenerationReviewSchema,
  modelIdentitySchema,
  normalizedToolDefinitionSchema,
  riskAnalysisResultSchema,
  serializeAnalysisArtifact,
  toolProvenanceSchema,
  validateApprovedGuardGenerationReview
} from "@closure/writeguard/analysis";
import { z } from "zod";
import {
  GENERATION_MANIFEST_VERSION,
  GENERATOR_ID,
  GENERATOR_TEMPLATE_VERSION,
  GENERATOR_VERSION,
  VERIFICATION_BUNDLE_VERSION,
  type GenerationManifest,
  type GenerationVerificationBundle
} from "./generate.js";
import {
  VERIFICATION_CONTRACT_VERSION,
  VERIFIER_ID,
  VERIFIER_VERSION,
  verificationReceiptSchema,
  type VerificationCheck,
  type VerificationLimitation,
  type VerificationMode,
  type VerificationReceipt,
  type VerificationStatus
} from "./verification-contracts.js";

export const MAX_VERIFICATION_MANIFEST_BYTES = 512 * 1024;
export const MAX_VERIFIED_FILE_BYTES = 1024 * 1024;
export const MAX_VERIFIED_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_VERIFIED_FILES = 128;
export const DEFAULT_VERIFICATION_TIMEOUT_MS = 30_000;
export const DEFAULT_VERIFICATION_OUTPUT_BYTES = 64 * 1024;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const messageSchema = z.string().min(1).max(600);

const generationManifestSchema = z.object({
  schemaVersion: z.literal(generationContractVersion),
  manifestVersion: z.literal(GENERATION_MANIFEST_VERSION),
  kind: z.literal("writeguard_generation_manifest"),
  generator: generatorDescriptorSchema,
  templateVersion: z.string().min(1).max(200),
  generatedSymbol: z.string().min(1).max(100),
  sourceTool: z.object({
    provenance: toolProvenanceSchema,
    sourceDigest: digestSchema
  }).strict(),
  analysis: z.object({
    digest: digestSchema,
    contractVersion: z.literal(analysisContractVersion),
    analyzer: analyzerDescriptorSchema,
    model: modelIdentitySchema
  }).strict(),
  developerReview: z.object({
    reviewId: z.string().min(1).max(200),
    digest: digestSchema,
    reviewer: z.string().min(1).max(200),
    reviewedAt: z.string().datetime({ offset: true })
  }).strict(),
  manifestPath: z.literal("writeguard-generation.json"),
  verificationBundle: z.object({
    path: z.literal("writeguard-verification-bundle.json"),
    sha256: digestSchema
  }).strict(),
  files: z.array(z.object({
    path: z.string().min(1).max(300),
    sha256: digestSchema
  }).strict()).min(1).max(MAX_VERIFIED_FILES),
  supportedFailureScenarios: z.array(z.string().min(1).max(100)).max(20),
  omittedFailureScenarios: z.array(z.string().min(1).max(100)).max(20),
  developerIntegrationRequirements: z.array(messageSchema).max(20),
  simulationLimitations: z.array(messageSchema).max(20)
}).strict();

const verificationBundleSchema = z.object({
  schemaVersion: z.literal(VERIFICATION_BUNDLE_VERSION),
  kind: z.literal("writeguard_generation_verification_bundle"),
  tool: normalizedToolDefinitionSchema,
  analysis: riskAnalysisResultSchema,
  review: guardGenerationReviewSchema
}).strict();

const verificationRequestSchema = z.object({
  directory: z.string().min(1).max(4096),
  runTests: z.boolean().optional().default(false),
  strict: z.boolean().optional().default(false),
  providerFile: z.string().min(1).max(300).optional(),
  timeoutMs: z.number().int().min(100).max(120_000).optional().default(DEFAULT_VERIFICATION_TIMEOUT_MS),
  maxOutputBytes: z.number().int().min(1024).max(256 * 1024).optional()
    .default(DEFAULT_VERIFICATION_OUTPUT_BYTES)
}).strict();

export type VerifyGeneratedIntegrationOptions = z.input<typeof verificationRequestSchema>;

export type VerificationProcessRequest = {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  env: NodeJS.ProcessEnv;
};

export type VerificationProcessResult = {
  kind: "completed" | "timeout" | "output_limit" | "spawn_error";
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export interface VerificationProcessRunner {
  run(request: VerificationProcessRequest): Promise<VerificationProcessResult>;
}

export type VerificationRuntimeMetadata = {
  durationMs: number;
  compilationDurationMs: number;
  generatedTestDurationMs: number | null;
};

export type VerificationRun = {
  receipt: VerificationReceipt;
  receiptDigest: string;
  runtime: VerificationRuntimeMetadata;
};

export type VerificationDependencies = {
  processRunner?: VerificationProcessRunner;
  typescriptCompilerPath?: string;
};

class VerificationFailure extends Error {
  constructor(readonly code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "VerificationFailure";
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameArtifact(left: unknown, right: unknown): boolean {
  return serializeAnalysisArtifact(left) === serializeAnalysisArtifact(right);
}

function safeRelativePath(value: string): string {
  if (!value || isAbsolute(value) || posix.isAbsolute(value) || win32.isAbsolute(value) || value.includes("\\")) {
    throw new VerificationFailure("unsafe_path", "A generated artifact path is absolute or uses an unsafe separator.");
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../") ||
      value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new VerificationFailure("unsafe_path", "A generated artifact path contains traversal or non-normalized segments.");
  }
  return value;
}

function pathCollisionKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function sanitizeDiagnostic(value: string, root: string): string {
  const redacted = value
    .replaceAll(root, "<generated-directory>")
    .replace(/sk_(?:test|live)_[A-Za-z0-9]{12,}/g, "[REDACTED_CREDENTIAL]")
    .replace(/sk-proj-[A-Za-z0-9_-]{12,}/g, "[REDACTED_CREDENTIAL]")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED_CREDENTIAL]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (redacted || "The controlled process failed without a diagnostic message.").slice(0, 600);
}

function minimalChildEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    WRITEGUARD_VERIFICATION: "1",
    OPENAI_API_KEY: "",
    STRIPE_SECRET_KEY: ""
  };
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

class NodeVerificationProcessRunner implements VerificationProcessRunner {
  run(request: VerificationProcessRequest): Promise<VerificationProcessResult> {
    return new Promise((resolveRun) => {
      let settled = false;
      let termination: "timeout" | "output_limit" | null = null;
      let stdout = "";
      let stderr = "";
      let capturedBytes = 0;
      let timer: NodeJS.Timeout | undefined;
      const finish = (result: VerificationProcessResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolveRun(result);
      };
      const child = spawn(request.executable, request.args, {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      const capture = (target: "stdout" | "stderr", chunk: Buffer) => {
        capturedBytes += chunk.byteLength;
        const used = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
        const remaining = Math.max(0, request.maxOutputBytes - used);
        const text = chunk.subarray(0, remaining).toString("utf8");
        if (target === "stdout") stdout += text;
        else stderr += text;
        if (capturedBytes > request.maxOutputBytes && !termination) {
          termination = "output_limit";
          child.kill("SIGKILL");
        }
      };
      child.stdout?.on("data", (chunk: Buffer) => capture("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => capture("stderr", chunk));
      child.on("error", (error) => finish({
        kind: "spawn_error",
        exitCode: null,
        stdout,
        stderr: stderr + " " + error.message
      }));
      child.on("exit", (code) => finish({
        kind: termination ?? "completed",
        exitCode: code,
        stdout,
        stderr
      }));
      timer = setTimeout(() => {
        if (!termination) {
          termination = "timeout";
          child.kill("SIGKILL");
        }
      }, request.timeoutMs);
      timer.unref();
    });
  }
}

const defaultProcessRunner = new NodeVerificationProcessRunner();

function fixedLimitations(): VerificationLimitation[] {
  return [
    {
      code: "digests_are_not_authenticity",
      level: "artifact_integrity",
      message: "SHA-256 digests establish integrity and binding, not authorship, authenticity, or trust in the original inputs.",
      nextAction: "Obtain source and review artifacts through a trusted organizational process."
    },
    {
      code: "compilation_is_not_provider_proof",
      level: "compilation",
      message: "Controlled compilation establishes public API type compatibility only.",
      nextAction: "Review and validate the provider implementation against provider-specific semantics."
    },
    {
      code: "child_process_is_not_sandbox",
      level: "simulated_failure_behavior",
      message: "Generated-test execution uses a constrained child process and is not a security sandbox.",
      nextAction: "Run opt-in tests only for integrity-verified artifacts in an appropriately isolated CI environment."
    },
    {
      code: "simulated_provider_only",
      level: "real_provider_semantics",
      message: "Generated tests use a deterministic simulated provider and do not verify a real provider.",
      nextAction: "Run a separately defined provider-specific adapter conformance workflow."
    },
    {
      code: "durable_storage_required",
      level: "provider_integration_completeness",
      message: "Generated tests use unsafe in-memory storage; deployment requires durable PostgreSQL-backed enforcement.",
      nextAction: "Configure and validate durable PostgreSQL storage before production use."
    }
  ];
}

function failedReceipt(mode: VerificationMode, code: string, message: string): VerificationReceipt {
  return verificationReceiptSchema.parse({
    schemaVersion: VERIFICATION_CONTRACT_VERSION,
    kind: "writeguard_verification_receipt",
    verifier: { id: VERIFIER_ID, version: VERIFIER_VERSION },
    mode,
    overallResult: "failed",
    inputs: {
      manifestDigest: null,
      verificationBundleDigest: null,
      sourceDigest: null,
      analysisDigest: null,
      developerReviewDigest: null,
      providerFileDigest: null
    },
    outputs: {
      verifiedFileSetDigest: null,
      compiledInputDigest: null,
      generatedTestDigest: null
    },
    checks: [{
      id: "artifact.manifest",
      level: "artifact_integrity",
      status: "failed",
      summary: "Artifact integrity verification failed before executable checks.",
      diagnostics: [{ code, message }]
    }],
    levels: [
      { level: "artifact_integrity", status: "failed", verifiedGuarantees: [], limitations: [message] },
      {
        level: "compilation",
        status: "not_run",
        verifiedGuarantees: [],
        limitations: ["Compilation was skipped because artifact integrity failed."]
      },
      {
        level: "simulated_failure_behavior",
        status: "not_run",
        verifiedGuarantees: [],
        limitations: ["Generated tests were not executed."]
      },
      {
        level: "provider_integration_completeness",
        status: "not_run",
        verifiedGuarantees: [],
        limitations: ["Provider-boundary inspection was not completed."]
      },
      {
        level: "real_provider_semantics",
        status: "not_run",
        verifiedGuarantees: [],
        limitations: ["No real-provider conformance workflow ran."]
      }
    ],
    extraFiles: [],
    limitations: fixedLimitations(),
    nextActions: ["Restore or regenerate the directory from approved bound artifacts, then verify again."]
  });
}

async function assertRootDirectory(root: string): Promise<string> {
  let state;
  try {
    state = await lstat(root);
  } catch (error) {
    throw new VerificationFailure(
      "directory_missing",
      "The generated directory does not exist or cannot be read.",
      { cause: error }
    );
  }
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw new VerificationFailure("directory_unsafe", "The verification target must be a real directory, not a symlink or file.");
  }
  const canonical = await realpath(root);
  const left = process.platform === "win32" ? root.toLocaleLowerCase("en-US") : root;
  const right = process.platform === "win32" ? canonical.toLocaleLowerCase("en-US") : canonical;
  if (left !== right) {
    throw new VerificationFailure("directory_symlink_ancestor", "The verification target resolves through a symlinked path.");
  }
  return canonical;
}

async function readSafeFile(root: string, relativePath: string): Promise<Buffer> {
  const safe = safeRelativePath(relativePath);
  const absolute = join(root, ...safe.split("/"));
  let state;
  try {
    state = await lstat(absolute);
  } catch (error) {
    throw new VerificationFailure("file_missing", "Required generated file " + safe + " is missing.", { cause: error });
  }
  if (state.isSymbolicLink() || !state.isFile()) {
    throw new VerificationFailure("file_symlink", "Required generated file " + safe + " is not a regular non-symlink file.");
  }
  if (state.size > MAX_VERIFIED_FILE_BYTES) {
    throw new VerificationFailure("file_oversized", "Required generated file " + safe + " exceeds the size limit.");
  }
  const canonical = await realpath(absolute);
  const escaped = relative(root, canonical);
  if (escaped === ".." || escaped.startsWith(".." + sep) || isAbsolute(escaped)) {
    throw new VerificationFailure("file_escape", "Required generated file " + safe + " resolves outside the directory.");
  }
  return readFile(absolute);
}

const ignoredInventoryDirectories = new Set([".git", "dist", "node_modules"]);

async function inventoryDirectory(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (ignoredInventoryDirectories.has(entry.name) || entry.name.startsWith(".writeguard-verify-")) continue;
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isSymbolicLink()) {
        throw new VerificationFailure("inventory_symlink", "Symlink " + path + " is not allowed inside the directory.");
      }
      if (entry.isDirectory()) await visit(join(directory, entry.name), path);
      else if (entry.isFile()) {
        files.push(path);
        if (files.length > 512) {
          throw new VerificationFailure("inventory_excessive", "The directory contains too many files to verify safely.");
        }
      }
    }
  }
  await visit(root, "");
  return files.sort();
}

function assertNoCaseCollisions(paths: string[]): void {
  const keys = new Map<string, string>();
  for (const path of paths) {
    const key = pathCollisionKey(path);
    const previous = keys.get(key);
    if (previous) {
      throw new VerificationFailure(
        "path_case_collision",
        "Generated paths " + previous + " and " + path + " collide on case-insensitive filesystems."
      );
    }
    keys.set(key, path);
  }
}

function scanContent(path: string, content: string): void {
  if (/\{\{[^{}]+\}\}|__WRITEGUARD_[A-Z0-9_]+__|<%=?/.test(content)) {
    throw new VerificationFailure("unresolved_template", "Generated file " + path + " contains an unresolved template marker.");
  }
  if (/sk_(?:test|live)_[A-Za-z0-9]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}/.test(content)) {
    throw new VerificationFailure("secret_shaped_value", "Generated file " + path + " contains a credential-shaped value.");
  }
  for (const match of content.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
    const specifier = match[1]!;
    if (specifier === "openai" || specifier.startsWith("openai/") || specifier.startsWith("@openai/")) {
      throw new VerificationFailure("openai_runtime_dependency", "Generated file " + path + " imports OpenAI.");
    }
    if (specifier.startsWith("@closure/writeguard/") &&
        !["@closure/writeguard/analysis", "@closure/writeguard/testing"].includes(specifier)) {
      throw new VerificationFailure("private_writeguard_import", "Generated file " + path + " imports a private WriteGuard path.");
    }
    if (specifier.includes("packages/writeguard/src") || specifier.includes("dist/writeguard/src")) {
      throw new VerificationFailure("private_writeguard_import", "Generated file " + path + " imports a private implementation path.");
    }
  }
}

function inspectGeneratedPackage(content: string): void {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch (error) {
    throw new VerificationFailure("generated_package_invalid", "Generated package.json is not valid JSON.", { cause: error });
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new VerificationFailure("generated_package_invalid", "Generated package.json must be an object.");
  }
  const value = manifest as Record<string, unknown>;
  for (const name of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const section = value[name];
    if (section && typeof section === "object" && !Array.isArray(section) &&
        Object.keys(section as Record<string, unknown>).some((key) => key === "openai" || key.startsWith("@openai/"))) {
      throw new VerificationFailure("openai_runtime_dependency", "Generated package.json declares an OpenAI dependency.");
    }
  }
}

function compilerArgs(root: string, files: string[], outDir?: string): string[] {
  const args = [
    "--pretty", "false",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--strict",
    "--exactOptionalPropertyTypes",
    "--noUncheckedIndexedAccess",
    "--esModuleInterop",
    "--skipLibCheck",
    "--types", "node",
    "--rootDir", root
  ];
  if (outDir) args.push("--outDir", outDir, "--sourceMap", "false", "--declaration", "false");
  else args.push("--noEmit");
  args.push(...files.map((path) => join(root, ...path.split("/"))));
  return args;
}

function processFailureDiagnostic(
  prefix: string,
  result: VerificationProcessResult,
  root: string
): { code: string; message: string } {
  const code = result.kind === "timeout"
    ? prefix + "_timeout"
    : result.kind === "output_limit"
      ? prefix + "_output_limit"
      : result.kind === "spawn_error"
        ? prefix + "_spawn_error"
        : prefix + "_failed";
  return {
    code,
    message: sanitizeDiagnostic(result.stderr || result.stdout || prefix + " exited with " + result.exitCode, root)
  };
}

function resolveTypescriptCompiler(): string {
  try {
    return createRequire(import.meta.url).resolve("typescript/lib/tsc.js");
  } catch (error) {
    throw new VerificationFailure(
      "typescript_unavailable",
      "The verifier-controlled TypeScript compiler is unavailable.",
      { cause: error }
    );
  }
}

function finalize(
  receipt: VerificationReceipt,
  startedAt: number,
  compilationDurationMs: number,
  generatedTestDurationMs: number | null
): VerificationRun {
  const parsed = verificationReceiptSchema.parse(receipt);
  return {
    receipt: parsed,
    receiptDigest: digestAnalysisArtifact(parsed),
    runtime: {
      durationMs: Date.now() - startedAt,
      compilationDurationMs,
      generatedTestDurationMs
    }
  };
}

export async function verifyGeneratedIntegration(
  options: VerifyGeneratedIntegrationOptions,
  dependencies: VerificationDependencies = {}
): Promise<VerificationRun> {
  const startedAt = Date.now();
  const parsedOptions = verificationRequestSchema.parse(options);
  const mode: VerificationMode = parsedOptions.runTests
    ? "safe_static_and_generated_tests"
    : "safe_static";
  const root = resolve(parsedOptions.directory);
  let compilationDurationMs = 0;
  let generatedTestDurationMs: number | null = null;
  try {
    const canonicalRoot = await assertRootDirectory(root);
    const manifestBytes = await readSafeFile(canonicalRoot, "writeguard-generation.json");
    if (manifestBytes.byteLength > MAX_VERIFICATION_MANIFEST_BYTES) {
      throw new VerificationFailure("manifest_oversized", "The generation manifest exceeds the size limit.");
    }
    let manifest: GenerationManifest;
    try {
      manifest = generationManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8"))) as GenerationManifest;
    } catch (error) {
      throw new VerificationFailure(
        "manifest_invalid",
        "The generation manifest is invalid or uses an unsupported contract version.",
        { cause: error }
      );
    }
    if (manifest.generator.id !== GENERATOR_ID || manifest.generator.version !== GENERATOR_VERSION) {
      throw new VerificationFailure("generator_unsupported", "The manifest identifies an unsupported generator version.");
    }
    if (manifest.templateVersion !== GENERATOR_TEMPLATE_VERSION) {
      throw new VerificationFailure("template_unsupported", "The manifest identifies an unsupported template version.");
    }

    const manifestPaths = manifest.files.map((file) => safeRelativePath(file.path));
    if (manifestPaths.includes(manifest.manifestPath)) {
      throw new VerificationFailure("manifest_self_owned", "The manifest cannot include itself in its file inventory.");
    }
    if (new Set(manifestPaths).size !== manifestPaths.length) {
      throw new VerificationFailure("path_duplicate", "The manifest contains duplicate normalized paths.");
    }
    assertNoCaseCollisions([...manifestPaths, manifest.manifestPath]);
    if (!manifestPaths.includes(manifest.verificationBundle.path)) {
      throw new VerificationFailure("bundle_unowned", "The verification bundle is not owned by the manifest.");
    }

    const inventory = await inventoryDirectory(canonicalRoot);
    const expected = new Set([...manifestPaths, manifest.manifestPath]);
    const providerPath = parsedOptions.providerFile ? safeRelativePath(parsedOptions.providerFile) : undefined;
    if (providerPath && expected.has(providerPath)) {
      throw new VerificationFailure(
        "provider_file_generated",
        "Provider implementation evidence must be a separate user-created file."
      );
    }
    const extras = inventory.filter((path) => !expected.has(path));
    const strictExtras = extras.filter((path) => path !== providerPath);
    if (parsedOptions.strict && strictExtras.length > 0) {
      throw new VerificationFailure("extra_files_strict", "Strict verification rejects files outside the manifest.");
    }

    const contents = new Map<string, Buffer>();
    let totalBytes = manifestBytes.byteLength;
    for (const file of manifest.files) {
      const content = await readSafeFile(canonicalRoot, file.path);
      totalBytes += content.byteLength;
      if (totalBytes > MAX_VERIFIED_TOTAL_BYTES) {
        throw new VerificationFailure("artifact_set_oversized", "The generated artifact set exceeds the total size limit.");
      }
      if (sha256(content) !== file.sha256) {
        throw new VerificationFailure("file_digest_mismatch", "Generated file " + file.path + " does not match its digest.");
      }
      contents.set(file.path, content);
      scanContent(file.path, content.toString("utf8"));
    }

    const bundleBytes = contents.get(manifest.verificationBundle.path)!;
    const ownedBundleDigest = manifest.files.find((file) => file.path === manifest.verificationBundle.path)?.sha256;
    if (sha256(bundleBytes) !== manifest.verificationBundle.sha256 ||
        ownedBundleDigest !== manifest.verificationBundle.sha256) {
      throw new VerificationFailure("bundle_digest_mismatch", "The verification bundle digest does not match the manifest.");
    }
    let bundle: GenerationVerificationBundle;
    try {
      bundle = verificationBundleSchema.parse(JSON.parse(bundleBytes.toString("utf8"))) as GenerationVerificationBundle;
    } catch (error) {
      throw new VerificationFailure(
        "bundle_invalid",
        "The verification bundle is invalid or uses an unsupported contract version.",
        { cause: error }
      );
    }
    let bound;
    try {
      bound = validateApprovedGuardGenerationReview({
        tool: bundle.tool,
        analysis: bundle.analysis,
        review: bundle.review
      });
    } catch (error) {
      throw new VerificationFailure(
        "binding_invalid",
        "The verification bundle does not contain a valid approved and bound review.",
        { cause: error }
      );
    }

    const sourceDigest = digestAnalysisArtifact(bound.tool);
    const analysisDigest = digestAnalysisArtifact(bound.analysis);
    const reviewDigest = digestAnalysisArtifact(bound.review);
    if (manifest.sourceTool.sourceDigest !== sourceDigest ||
        !sameArtifact(manifest.sourceTool.provenance, bound.tool.provenance)) {
      throw new VerificationFailure("source_binding_mismatch", "The source-tool identity or digest does not match.");
    }
    if (manifest.analysis.digest !== analysisDigest ||
        manifest.analysis.contractVersion !== bound.analysis.schemaVersion ||
        !sameArtifact(manifest.analysis.analyzer, bound.analysis.analyzer) ||
        !sameArtifact(manifest.analysis.model, bound.review.binding.analysis.model)) {
      throw new VerificationFailure("analysis_binding_mismatch", "The analysis identity or digest does not match.");
    }
    const attestation = bound.review.developerAttestation!;
    if (manifest.developerReview.digest !== reviewDigest ||
        manifest.developerReview.reviewId !== bound.review.reviewId ||
        manifest.developerReview.reviewer !== attestation.reviewer ||
        manifest.developerReview.reviewedAt !== attestation.reviewedAt) {
      throw new VerificationFailure("review_binding_mismatch", "The approved developer-review binding does not match.");
    }

    const packageContent = contents.get("package.json");
    if (!packageContent) {
      throw new VerificationFailure("generated_package_missing", "Generated package.json is missing from the manifest.");
    }
    inspectGeneratedPackage(packageContent.toString("utf8"));

    let providerFileDigest: string | null = null;
    let providerImplemented = false;
    if (providerPath) {
      const providerBytes = await readSafeFile(canonicalRoot, providerPath);
      const providerContent = providerBytes.toString("utf8");
      scanContent(providerPath, providerContent);
      providerFileDigest = sha256(providerBytes);
      providerImplemented = /ProviderBoundary/.test(providerContent) &&
        /\bexecute\s*[:(]/.test(providerContent) &&
        /\breconcile\s*[:(]/.test(providerContent) &&
        /\bverify\s*[:(]/.test(providerContent) &&
        !providerContent.includes("WRITEGUARD_PROVIDER_BOUNDARY_SCAFFOLD");
      if (!providerImplemented) {
        throw new VerificationFailure(
          "provider_boundary_incomplete",
          "The supplied provider file does not implement execute, reconcile, and verify."
        );
      }
    }

    const generatedTypeScriptFiles = manifestPaths.filter((path) => path.endsWith(".ts")).sort();
    if (!generatedTypeScriptFiles.includes("test/failure.test.ts")) {
      throw new VerificationFailure("generated_test_missing", "The controlled generated failure test is missing.");
    }
    const compilationFiles = providerPath
      ? [...generatedTypeScriptFiles, providerPath].sort()
      : generatedTypeScriptFiles;
    const compiler = dependencies.typescriptCompilerPath ?? resolveTypescriptCompiler();
    const runner = dependencies.processRunner ?? defaultProcessRunner;
    const compilationStartedAt = Date.now();
    const compilation = await runner.run({
      executable: process.execPath,
      args: [compiler, ...compilerArgs(canonicalRoot, compilationFiles)],
      cwd: canonicalRoot,
      timeoutMs: parsedOptions.timeoutMs,
      maxOutputBytes: parsedOptions.maxOutputBytes,
      env: minimalChildEnvironment()
    });
    compilationDurationMs = Date.now() - compilationStartedAt;
    const compilationPassed = compilation.kind === "completed" && compilation.exitCode === 0;

    let testCheck: VerificationCheck;
    if (!parsedOptions.runTests) {
      testCheck = {
        id: "tests.generated_failure_behavior",
        level: "simulated_failure_behavior",
        status: "not_run",
        summary: "Generated test execution was not requested; static verification executed no generated code.",
        diagnostics: [{
          code: "explicit_opt_in_required",
          message: "Use --run-tests only after reviewing that child-process execution is not a security sandbox."
        }]
      };
    } else if (!compilationPassed) {
      testCheck = {
        id: "tests.generated_failure_behavior",
        level: "simulated_failure_behavior",
        status: "not_run",
        summary: "Generated tests were not executed because controlled compilation failed.",
        diagnostics: [{
          code: "compilation_required",
          message: "Artifact integrity and compilation must pass before generated code can execute."
        }]
      };
    } else {
      const outputDirectory = join(canonicalRoot, ".writeguard-verify-" + randomUUID());
      const testStartedAt = Date.now();
      try {
        await mkdir(outputDirectory, { recursive: false });
        const emit = await runner.run({
          executable: process.execPath,
          args: [compiler, ...compilerArgs(canonicalRoot, generatedTypeScriptFiles, outputDirectory)],
          cwd: canonicalRoot,
          timeoutMs: parsedOptions.timeoutMs,
          maxOutputBytes: parsedOptions.maxOutputBytes,
          env: minimalChildEnvironment()
        });
        if (emit.kind !== "completed" || emit.exitCode !== 0) {
          testCheck = {
            id: "tests.generated_failure_behavior",
            level: "simulated_failure_behavior",
            status: "failed",
            summary: "Verifier-controlled test compilation failed.",
            diagnostics: [processFailureDiagnostic("test_compile", emit, canonicalRoot)]
          };
        } else {
          const testResult = await runner.run({
            executable: process.execPath,
            args: ["--test", join(outputDirectory, "test", "failure.test.js")],
            cwd: canonicalRoot,
            timeoutMs: parsedOptions.timeoutMs,
            maxOutputBytes: parsedOptions.maxOutputBytes,
            env: minimalChildEnvironment()
          });
          const passed = testResult.kind === "completed" && testResult.exitCode === 0;
          testCheck = passed
            ? {
                id: "tests.generated_failure_behavior",
                level: "simulated_failure_behavior",
                status: "passed_with_limitations",
                summary: "The controlled generated test passed " +
                  manifest.supportedFailureScenarios.length + " simulated failure scenarios.",
                diagnostics: []
              }
            : {
                id: "tests.generated_failure_behavior",
                level: "simulated_failure_behavior",
                status: "failed",
                summary: "The controlled generated failure test failed.",
                diagnostics: [processFailureDiagnostic("generated_tests", testResult, canonicalRoot)]
              };
        }
      } finally {
        await rm(outputDirectory, { recursive: true, force: true });
        generatedTestDurationMs = Date.now() - testStartedAt;
      }
    }

    const compilationCheck: VerificationCheck = compilationPassed
      ? {
          id: "compilation.public_surfaces",
          level: "compilation",
          status: "passed",
          summary: "Generated TypeScript typechecks with verifier-controlled arguments against public package surfaces.",
          diagnostics: []
        }
      : {
          id: "compilation.public_surfaces",
          level: "compilation",
          status: "failed",
          summary: "Generated TypeScript failed verifier-controlled compilation.",
          diagnostics: [processFailureDiagnostic("compilation", compilation, canonicalRoot)]
        };
    const extraCheck: VerificationCheck = extras.length === 0
      ? {
          id: "artifact.extra_files",
          level: "artifact_integrity",
          status: "not_applicable",
          summary: "No user-created files were present outside the generation manifest.",
          diagnostics: []
        }
      : {
          id: "artifact.extra_files",
          level: "artifact_integrity",
          status: "passed_with_limitations",
          summary: extras.length + " user-created file(s) were reported but did not affect generated-artifact integrity.",
          diagnostics: []
        };
    const providerCheck: VerificationCheck = providerImplemented
      ? {
          id: "provider.boundary",
          level: "provider_integration_completeness",
          status: compilationPassed ? "passed_with_limitations" : "failed",
          summary: compilationPassed
            ? "The explicit provider implementation has the required boundary shape and typechecks; semantics remain unverified."
            : "The explicit provider implementation was present but did not pass controlled compilation.",
          diagnostics: []
        }
      : {
          id: "provider.boundary",
          level: "provider_integration_completeness",
          status: "passed_with_limitations",
          summary: "The generated execute, reconcile, and verify boundary remains a developer implementation scaffold.",
          diagnostics: [{
            code: "provider_implementation_not_supplied",
            message: "Pass --provider-file with a reviewed relative implementation path to include static shape and type compatibility."
          }]
        };
    const checks: VerificationCheck[] = [
      {
        id: "artifact.manifest",
        level: "artifact_integrity",
        status: "passed",
        summary: "The manifest uses supported contracts, generator identity, and template version.",
        diagnostics: []
      },
      {
        id: "artifact.paths_and_digests",
        level: "artifact_integrity",
        status: "passed",
        summary: "Expected files exist as bounded regular files and every manifest digest matches.",
        diagnostics: []
      },
      {
        id: "artifact.provenance_bindings",
        level: "artifact_integrity",
        status: "passed",
        summary: "Source, analysis, approved review, and generator bindings match the manifest-owned bundle.",
        diagnostics: []
      },
      {
        id: "artifact.static_policy",
        level: "artifact_integrity",
        status: "passed",
        summary: "Generated files contain no unresolved markers, secrets, private imports, or OpenAI dependencies.",
        diagnostics: []
      },
      extraCheck,
      compilationCheck,
      providerCheck,
      testCheck,
      {
        id: "provider.real_semantics",
        level: "real_provider_semantics",
        status: "not_run",
        summary: "No real-provider adapter conformance workflow ran.",
        diagnostics: [{
          code: "real_provider_not_verified",
          message: "Simulation and compilation cannot establish provider idempotency, reconciliation, or consistency."
        }]
      }
    ];
    const failed = checks.some((check) => check.status === "failed");
    const artifactStatus: VerificationStatus = extras.length > 0 ? "passed_with_limitations" : "passed";
    const receipt = verificationReceiptSchema.parse({
      schemaVersion: VERIFICATION_CONTRACT_VERSION,
      kind: "writeguard_verification_receipt",
      verifier: { id: VERIFIER_ID, version: VERIFIER_VERSION },
      mode,
      overallResult: failed ? "failed" : "passed_with_limitations",
      inputs: {
        manifestDigest: sha256(manifestBytes),
        verificationBundleDigest: sha256(bundleBytes),
        sourceDigest,
        analysisDigest,
        developerReviewDigest: reviewDigest,
        providerFileDigest
      },
      outputs: {
        verifiedFileSetDigest: digestAnalysisArtifact(manifest.files),
        compiledInputDigest: digestAnalysisArtifact(compilationFiles.map((path) => ({
          path,
          sha256: path === providerPath
            ? providerFileDigest
            : manifest.files.find((file) => file.path === path)!.sha256
        }))),
        generatedTestDigest: manifest.files.find((file) => file.path === "test/failure.test.ts")?.sha256 ?? null
      },
      checks,
      levels: [
        {
          level: "artifact_integrity",
          status: artifactStatus,
          verifiedGuarantees: [
            "Manifest-owned generated files match their expected digests.",
            "The complete source, analysis, approved-review, and generator digest chain matches."
          ],
          limitations: extras.length > 0 ? ["User-created extra files are outside generated-artifact integrity."] : []
        },
        {
          level: "compilation",
          status: compilationCheck.status,
          verifiedGuarantees: compilationPassed
            ? ["Generated TypeScript is type-compatible with supported public package surfaces."]
            : [],
          limitations: ["Compilation does not establish runtime or provider correctness."]
        },
        {
          level: "simulated_failure_behavior",
          status: testCheck.status,
          verifiedGuarantees: testCheck.status === "passed_with_limitations"
            ? ["The manifest-owned generated failure test passed against its deterministic simulated provider."]
            : [],
          limitations: ["Simulated behavior does not establish real-provider semantics."]
        },
        {
          level: "provider_integration_completeness",
          status: providerCheck.status,
          verifiedGuarantees: providerImplemented && compilationPassed
            ? ["An explicit execute, reconcile, and verify implementation was present and type-compatible."]
            : ["The required provider boundary hooks were identified."],
          limitations: ["Provider-specific behavior was not established by static inspection or compilation."]
        },
        {
          level: "real_provider_semantics",
          status: "not_run",
          verifiedGuarantees: [],
          limitations: ["No real-provider adapter conformance workflow ran."]
        }
      ],
      extraFiles: extras,
      limitations: fixedLimitations(),
      nextActions: [
        ...(providerImplemented ? [] : ["Implement the provider boundary and verify it with --provider-file."]),
        ...(parsedOptions.runTests ? [] : ["Review the generated test and rerun with --run-tests."]),
        "Run provider-specific conformance checks before making any real-provider guarantee.",
        "Use durable PostgreSQL-backed enforcement for deployment."
      ]
    });
    return finalize(receipt, startedAt, compilationDurationMs, generatedTestDurationMs);
  } catch (error) {
    const failure = error instanceof VerificationFailure
      ? error
      : new VerificationFailure(
          "verification_failed",
          "Verification failed with a sanitized internal diagnostic.",
          { cause: error }
        );
    return finalize(
      failedReceipt(mode, failure.code, sanitizeDiagnostic(failure.message, root)),
      startedAt,
      compilationDurationMs,
      generatedTestDurationMs
    );
  }
}
