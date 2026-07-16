import { readFile } from "node:fs/promises";
import {
  McpToolDefinitionError,
  normalizeMcpToolDefinition,
  serializeAnalysisArtifact
} from "./analysis/index.js";

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
  "",
  "Iteration 1 normalizes and validates one MCP tool definition. It does not perform AI risk analysis."
].join("\n");

function parseOptions(args: string[]): {
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
    if (path) throw new Error("normalize-mcp accepts exactly one tool-definition path or - for stdin");
    path = argument;
  }
  if (!path) throw new Error("normalize-mcp requires a tool-definition path or - for stdin");
  return {
    path,
    pretty,
    ...(values["--server-name"] ? { serverName: values["--server-name"] } : {}),
    ...(values["--server-version"] ? { serverVersion: values["--server-version"] } : {}),
    ...(values["--source-label"] ? { sourceLabel: values["--source-label"] } : {})
  };
}

export async function runWriteGuardCli(
  args: string[],
  io: WriteGuardCliIo = defaultIo
): Promise<number> {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.stdout(`${usage}\n`);
    return 0;
  }
  if (command !== "normalize-mcp") {
    io.stderr(`writeguard: unsupported command ${command}\n\n${usage}\n`);
    return 2;
  }
  try {
    const options = parseOptions(args.slice(1));
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
    io.stdout(`${serializeAnalysisArtifact(normalized, { pretty: options.pretty })}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`writeguard: ${message}\n`);
    return error instanceof McpToolDefinitionError ? 3 : 2;
  }
}
