import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  McpToolDefinitionError,
  approveGuardGenerationReview,
  createGuardGenerationRequest,
  createGuardGenerationReviewDraft,
  digestAnalysisArtifact,
  normalizeMcpToolDefinition,
  runToolRiskAnalyzer,
  serializeAnalysisArtifact
} from "./analysis/index.js";
import type { GeneratorDescriptor, ToolRiskAnalyzer } from "./analysis/index.js";

export type WriteGuardCliIo = {
  stdout(message: string): void;
  stderr(message: string): void;
  readStdin(): Promise<string>;
};

async function readProcessStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const defaultIo: WriteGuardCliIo = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
  readStdin: readProcessStdin
};

const usage = [
  "Usage:",
  "  writeguard normalize-mcp <tool-definition.json|-> [--pretty]",
  "    [--server-name <name>] [--server-version <version>] [--source-label <label>]",
  "  writeguard analyze <tool-definition.json|-> [--pretty]",
  "    [--server-name <name>] [--server-version <version>] [--source-label <label>]",
  "  writeguard review --tool <normalized-tool.json> --analysis <analysis.json>",
  "    --out <draft-review.json> [--proposal <proposal-id>] [--pretty]",
  "  writeguard approve --tool <normalized-tool.json> --analysis <analysis.json>",
  "    --review <edited-draft.json> --reviewer <non-secret-id> --out <approved-review.json>",
  "    [--reviewed-at <ISO-8601>] [--pretty]",
  "  writeguard generate --tool <normalized-tool.json> --analysis <analysis.json>",
  "    --review <approved-review.json> --out-dir <new-directory> [--pretty]",
  "  writeguard verify <generated-directory> [--provider-file <relative-path>]",
  "    [--strict] [--run-tests] [--timeout-ms <milliseconds>] [--pretty]",
  "",
  "analyze requires @closure/writeguard-analyzer-openai and OPENAI_API_KEY; it uses gpt-5.6.",
  "generate requires the optional @closure/writeguard-generator package and makes no network requests.",
  "verify uses that package for safe static checks; --run-tests explicitly executes manifest-owned generated code.",
  "review creates an unapproved editable file; approve has no --yes bypass."
].join("\n");

type AnalyzeCommand = "normalize-mcp" | "analyze";

function parseAnalyzeOptions(command: AnalyzeCommand, args: string[]): {
  path: string;
  pretty: boolean;
  serverName?: string;
  serverVersion?: string;
  sourceLabel?: string;
} {
  let path: string | undefined;
  let pretty = false;
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--pretty") {
      pretty = true;
      continue;
    }
    if (["--server-name", "--server-version", "--source-label"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      values[argument] = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`unsupported option ${argument}`);
    if (path) throw new Error(`${command} accepts exactly one tool-definition path or - for stdin`);
    path = argument;
  }
  if (!path) throw new Error(`${command} requires a tool-definition path or - for stdin`);
  return {
    path,
    pretty,
    ...(values["--server-name"] ? { serverName: values["--server-name"] } : {}),
    ...(values["--server-version"] ? { serverVersion: values["--server-version"] } : {}),
    ...(values["--source-label"] ? { sourceLabel: values["--source-label"] } : {})
  };
}

function parseNamedOptions(
  command: string,
  args: string[],
  required: readonly string[],
  optional: readonly string[] = []
): { values: Record<string, string>; pretty: boolean } {
  const allowed = new Set([...required, ...optional]);
  const values: Record<string, string> = {};
  let pretty = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--pretty") {
      pretty = true;
      continue;
    }
    if (!argument.startsWith("--") || !allowed.has(argument)) {
      throw new Error(`${command}: unsupported argument ${argument}`);
    }
    if (values[argument] !== undefined) throw new Error(`${command}: duplicate option ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    values[argument] = value;
    index += 1;
  }
  for (const option of required) {
    if (!values[option]) throw new Error(`${command} requires ${option}`);
  }
  return { values, pretty };
}

async function readJsonArtifact(path: string, label: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${path}.`, { cause: error });
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeNewJsonArtifact(path: string, value: unknown): Promise<string> {
  const target = resolve(path);
  if (await pathExists(target)) {
    throw new Error(`Refusing to overwrite existing artifact ${target}.`);
  }
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.writeguard-${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      `${serializeAnalysisArtifact(value, { pretty: true })}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    if (await pathExists(target)) throw new Error(`Output artifact ${target} appeared while writing.`);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return target;
}

type GenerateAndPublishResult = {
  outDir: string;
  files: string[];
  manifest: unknown;
};

type VerifyGeneratedResult = {
  receipt: {
    overallResult: "passed" | "failed" | "passed_with_limitations" | "not_run" | "not_applicable";
  };
  receiptDigest: string;
  runtime: {
    durationMs: number;
    compilationDurationMs: number;
    generatedTestDurationMs: number | null;
  };
};

export type WriteGuardCliDependencies = {
  loadAnalyzer?: () => Promise<ToolRiskAnalyzer>;
  generateAndPublish?: (options: {
    tool: unknown;
    analysis: unknown;
    review: unknown;
    outDir: string;
  }) => Promise<GenerateAndPublishResult>;
  verifyGenerated?: (options: {
    directory: string;
    runTests: boolean;
    strict: boolean;
    providerFile?: string;
    timeoutMs?: number;
  }) => Promise<VerifyGeneratedResult>;
  now?: () => string;
};

class OptionalPackageError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OptionalPackageError";
  }
}

async function loadOptionalOpenAIAnalyzer(): Promise<ToolRiskAnalyzer> {
  const packageName = "@closure/writeguard-analyzer-openai";
  let loaded: unknown;
  try {
    loaded = await import(packageName);
  } catch (error) {
    throw new OptionalPackageError(
      `The analyze command requires the optional ${packageName} package. Install it alongside @closure/writeguard, then retry.`,
      { cause: error }
    );
  }
  const factory = (loaded as { createOpenAIToolRiskAnalyzer?: unknown }).createOpenAIToolRiskAnalyzer;
  if (typeof factory !== "function") {
    throw new OptionalPackageError(
      `${packageName} is installed but does not expose createOpenAIToolRiskAnalyzer. Install a compatible package version.`
    );
  }
  return (factory as () => ToolRiskAnalyzer)();
}

async function generateAndPublishWithOptionalPackage(options: {
  tool: unknown;
  analysis: unknown;
  review: unknown;
  outDir: string;
}): Promise<GenerateAndPublishResult> {
  const packageName = "@closure/writeguard-generator";
  let loaded: unknown;
  try {
    loaded = await import(packageName);
  } catch (error) {
    throw new OptionalPackageError(
      `The generate command requires the optional ${packageName} package. Install it alongside @closure/writeguard, then retry.`,
      { cause: error }
    );
  }
  const value = loaded as {
    generatorDescriptor?: GeneratorDescriptor;
    generateGuardedToolProject?: (request: unknown) => { manifest: unknown; files: unknown[] };
    publishGeneratedProject?: (
      project: unknown,
      options: { outDir: string }
    ) => Promise<{ outDir: string; files: string[] }>;
  };
  if (!value.generatorDescriptor || typeof value.generateGuardedToolProject !== "function" ||
      typeof value.publishGeneratedProject !== "function") {
    throw new OptionalPackageError(
      `${packageName} is installed but does not expose a compatible generator API.`
    );
  }
  const request = createGuardGenerationRequest({
    generator: value.generatorDescriptor,
    tool: options.tool,
    analysis: options.analysis,
    review: options.review
  });
  const project = value.generateGuardedToolProject(request);
  const published = await value.publishGeneratedProject(project, { outDir: options.outDir });
  return { ...published, manifest: project.manifest };
}

async function verifyWithOptionalPackage(options: {
  directory: string;
  runTests: boolean;
  strict: boolean;
  providerFile?: string;
  timeoutMs?: number;
}): Promise<VerifyGeneratedResult> {
  const packageName = "@closure/writeguard-generator";
  let loaded: unknown;
  try {
    loaded = await import(packageName);
  } catch (error) {
    throw new OptionalPackageError(
      "The verify command requires the optional " + packageName +
        " package. Install it alongside @closure/writeguard, then retry.",
      { cause: error }
    );
  }
  const verifier = (loaded as { verifyGeneratedIntegration?: unknown }).verifyGeneratedIntegration;
  if (typeof verifier !== "function") {
    throw new OptionalPackageError(
      packageName + " is installed but does not expose a compatible verification API."
    );
  }
  return (verifier as (value: typeof options) => Promise<VerifyGeneratedResult>)(options);
}

const defaultDependencies = {
  loadAnalyzer: loadOptionalOpenAIAnalyzer,
  generateAndPublish: generateAndPublishWithOptionalPackage,
  verifyGenerated: verifyWithOptionalPackage,
  now: () => new Date().toISOString()
};

function writeResult(io: WriteGuardCliIo, value: unknown, pretty: boolean): void {
  io.stdout(`${serializeAnalysisArtifact(value, { pretty })}\n`);
}

async function runNormalizeOrAnalyze(
  command: AnalyzeCommand,
  args: string[],
  io: WriteGuardCliIo,
  dependencies: WriteGuardCliDependencies
): Promise<number> {
  const options = parseAnalyzeOptions(command, args);
  const content = options.path === "-" ? await io.readStdin() : await readFile(options.path, "utf8");
  let input: unknown;
  try {
    input = JSON.parse(content);
  } catch {
    throw new McpToolDefinitionError("Invalid MCP tool definition: input is not valid JSON");
  }
  const normalized = normalizeMcpToolDefinition(input, {
    ...(options.serverName ? { serverName: options.serverName } : {}),
    ...(options.serverVersion ? { serverVersion: options.serverVersion } : {}),
    ...(options.sourceLabel ? { sourceLabel: options.sourceLabel } : {})
  });
  const artifact = command === "normalize-mcp"
    ? normalized
    : await runToolRiskAnalyzer(
        await (dependencies.loadAnalyzer ?? defaultDependencies.loadAnalyzer)(),
        normalized
      );
  writeResult(io, artifact, options.pretty);
  return 0;
}

async function runReview(
  args: string[],
  io: WriteGuardCliIo
): Promise<number> {
  const options = parseNamedOptions(
    "review",
    args,
    ["--tool", "--analysis", "--out"],
    ["--proposal"]
  );
  const tool = await readJsonArtifact(options.values["--tool"]!, "normalized tool");
  const analysis = await readJsonArtifact(options.values["--analysis"]!, "analysis");
  const review = createGuardGenerationReviewDraft(tool, analysis, {
    ...(options.values["--proposal"] ? { proposalId: options.values["--proposal"] } : {})
  });
  const out = await writeNewJsonArtifact(options.values["--out"]!, review);
  writeResult(io, {
    command: "review",
    kind: "writeguard_cli_result",
    out,
    reviewId: review.reviewId,
    state: review.state,
    status: "draft_created"
  }, options.pretty);
  return 0;
}

async function runApprove(
  args: string[],
  io: WriteGuardCliIo,
  dependencies: WriteGuardCliDependencies
): Promise<number> {
  const options = parseNamedOptions(
    "approve",
    args,
    ["--tool", "--analysis", "--review", "--reviewer", "--out"],
    ["--reviewed-at"]
  );
  const tool = await readJsonArtifact(options.values["--tool"]!, "normalized tool");
  const analysis = await readJsonArtifact(options.values["--analysis"]!, "analysis");
  const review = await readJsonArtifact(options.values["--review"]!, "draft review");
  const approved = approveGuardGenerationReview({
    tool,
    analysis,
    review,
    reviewer: options.values["--reviewer"]!,
    reviewedAt: options.values["--reviewed-at"] ?? (dependencies.now ?? defaultDependencies.now)()
  });
  const out = await writeNewJsonArtifact(options.values["--out"]!, approved);
  writeResult(io, {
    command: "approve",
    kind: "writeguard_cli_result",
    out,
    reviewDigest: digestAnalysisArtifact(approved),
    reviewId: approved.reviewId,
    state: approved.state,
    status: "approved_review_created"
  }, options.pretty);
  return 0;
}

async function runGenerate(
  args: string[],
  io: WriteGuardCliIo,
  dependencies: WriteGuardCliDependencies
): Promise<number> {
  const options = parseNamedOptions(
    "generate",
    args,
    ["--tool", "--analysis", "--review", "--out-dir"]
  );
  const tool = await readJsonArtifact(options.values["--tool"]!, "normalized tool");
  const analysis = await readJsonArtifact(options.values["--analysis"]!, "analysis");
  const review = await readJsonArtifact(options.values["--review"]!, "approved review");
  const generated = await (dependencies.generateAndPublish ?? defaultDependencies.generateAndPublish)({
    tool,
    analysis,
    review,
    outDir: options.values["--out-dir"]!
  });
  writeResult(io, {
    command: "generate",
    fileCount: generated.files.length,
    kind: "writeguard_cli_result",
    manifestDigest: digestAnalysisArtifact(generated.manifest),
    outDir: generated.outDir,
    status: "generated"
  }, options.pretty);
  return 0;
}

function parseVerifyOptions(args: string[]): {
  directory: string;
  pretty: boolean;
  runTests: boolean;
  strict: boolean;
  providerFile?: string;
  timeoutMs?: number;
} {
  let directory: string | undefined;
  let pretty = false;
  let runTests = false;
  let strict = false;
  let providerFile: string | undefined;
  let timeoutMs: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--pretty") {
      pretty = true;
      continue;
    }
    if (argument === "--run-tests") {
      runTests = true;
      continue;
    }
    if (argument === "--strict") {
      strict = true;
      continue;
    }
    if (argument === "--provider-file" || argument === "--timeout-ms") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(argument + " requires a value");
      if (argument === "--provider-file") {
        if (providerFile) throw new Error("verify: duplicate option --provider-file");
        providerFile = value;
      } else {
        if (timeoutMs !== undefined) throw new Error("verify: duplicate option --timeout-ms");
        timeoutMs = Number(value);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
          throw new Error("--timeout-ms must be an integer from 100 through 120000");
        }
      }
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) throw new Error("verify: unsupported argument " + argument);
    if (directory) throw new Error("verify accepts exactly one generated directory");
    directory = argument;
  }
  if (!directory) throw new Error("verify requires a generated directory");
  return {
    directory,
    pretty,
    runTests,
    strict,
    ...(providerFile ? { providerFile } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {})
  };
}

async function runVerify(
  args: string[],
  io: WriteGuardCliIo,
  dependencies: WriteGuardCliDependencies
): Promise<number> {
  const options = parseVerifyOptions(args);
  if (options.runTests) {
    io.stderr(
      "writeguard: --run-tests executes integrity-verified generated code in a constrained child process; " +
      "this is not a security sandbox.\n"
    );
  }
  const result = await (dependencies.verifyGenerated ?? defaultDependencies.verifyGenerated)({
    directory: options.directory,
    runTests: options.runTests,
    strict: options.strict,
    ...(options.providerFile ? { providerFile: options.providerFile } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  });
  writeResult(io, result, options.pretty);
  return result.receipt.overallResult === "failed" ? 6 : 0;
}

export async function runWriteGuardCli(
  args: string[],
  io: WriteGuardCliIo = defaultIo,
  dependencies: WriteGuardCliDependencies = {}
): Promise<number> {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.stdout(`${usage}\n`);
    return 0;
  }
  if (!["normalize-mcp", "analyze", "review", "approve", "generate", "verify"].includes(command)) {
    io.stderr(`writeguard: unsupported command ${command}\n\n${usage}\n`);
    return 2;
  }
  try {
    if (command === "normalize-mcp" || command === "analyze") {
      return await runNormalizeOrAnalyze(command, args.slice(1), io, dependencies);
    }
    if (command === "review") return await runReview(args.slice(1), io);
    if (command === "approve") return await runApprove(args.slice(1), io, dependencies);
    if (command === "generate") return await runGenerate(args.slice(1), io, dependencies);
    return await runVerify(args.slice(1), io, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`writeguard: ${message}\n`);
    if (error instanceof McpToolDefinitionError) return 3;
    if (command === "analyze") return 4;
    if (["review", "approve", "generate"].includes(command)) return 5;
    if (command === "verify") return 6;
    return 2;
  }
}
