import { readFile } from "node:fs/promises";
import {
  McpToolDefinitionError,
  normalizeMcpToolDefinition,
  runToolRiskAnalyzer,
  serializeAnalysisArtifact
} from "./analysis/index.js";
import type { ToolRiskAnalyzer } from "./analysis/index.js";

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
  "",
  "analyze requires @closure/writeguard-analyzer-openai and OPENAI_API_KEY; it uses gpt-5.6."
].join("\n");

function parseOptions(command: "normalize-mcp" | "analyze", args: string[]): {
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

export type WriteGuardCliDependencies = {
  loadAnalyzer(): Promise<ToolRiskAnalyzer>;
};

class OptionalAnalyzerPackageError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OptionalAnalyzerPackageError";
  }
}

async function loadOptionalOpenAIAnalyzer(): Promise<ToolRiskAnalyzer> {
  const packageName = "@closure/writeguard-analyzer-openai";
  let loaded: unknown;
  try {
    loaded = await import(packageName);
  } catch (error) {
    throw new OptionalAnalyzerPackageError(
      `The analyze command requires the optional ${packageName} package. Install it alongside @closure/writeguard, then retry.`,
      { cause: error }
    );
  }
  const factory = (loaded as { createOpenAIToolRiskAnalyzer?: unknown }).createOpenAIToolRiskAnalyzer;
  if (typeof factory !== "function") {
    throw new OptionalAnalyzerPackageError(
      `${packageName} is installed but does not expose createOpenAIToolRiskAnalyzer. Install a compatible package version.`
    );
  }
  return (factory as () => ToolRiskAnalyzer)();
}

const defaultDependencies: WriteGuardCliDependencies = {
  loadAnalyzer: loadOptionalOpenAIAnalyzer
};

export async function runWriteGuardCli(
  args: string[],
  io: WriteGuardCliIo = defaultIo,
  dependencies: WriteGuardCliDependencies = defaultDependencies
): Promise<number> {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.stdout(`${usage}\n`);
    return 0;
  }
  if (command !== "normalize-mcp" && command !== "analyze") {
    io.stderr(`writeguard: unsupported command ${command}\n\n${usage}\n`);
    return 2;
  }
  try {
    const options = parseOptions(command, args.slice(1));
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
      : await runToolRiskAnalyzer(await dependencies.loadAnalyzer(), normalized);
    io.stdout(`${serializeAnalysisArtifact(artifact, { pretty: options.pretty })}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`writeguard: ${message}\n`);
    if (error instanceof McpToolDefinitionError) return 3;
    if (command === "analyze") return 4;
    return 2;
  }
}
