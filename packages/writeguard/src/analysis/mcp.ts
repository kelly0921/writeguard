import { z } from "zod";
import {
  analysisContractVersion,
  jsonObjectSchema,
  normalizedToolDefinitionSchema,
  type JsonObject,
  type JsonValue,
  type NormalizedToolDefinition
} from "./contracts.js";
import { digestAnalysisArtifact } from "./serialization.js";

const toolNameSchema = z.string()
  .min(1, "tool name is required")
  .max(128, "tool name must not exceed 128 characters")
  .regex(/^[A-Za-z0-9_.-]+$/, "tool name may contain letters, numbers, underscore, dot, and hyphen");

export const mcpToolDefinitionSchema = z.object({
  name: toolNameSchema,
  description: z.string().max(4_096).optional(),
  inputSchema: jsonObjectSchema,
  annotations: z.object({
    title: z.string().min(1).max(200).optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional()
  }).passthrough().optional()
}).passthrough().superRefine((value, context) => {
  if (value.inputSchema.type !== "object") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputSchema", "type"],
      message: "MCP tool inputSchema.type must be object"
    });
  }
  if (value.inputSchema.properties !== undefined &&
      (!value.inputSchema.properties || Array.isArray(value.inputSchema.properties) ||
       typeof value.inputSchema.properties !== "object")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputSchema", "properties"],
      message: "MCP tool inputSchema.properties must be an object when supplied"
    });
  }
});

export type McpToolDefinition = z.infer<typeof mcpToolDefinitionSchema>;

export type McpNormalizationProvenance = {
  serverName?: string;
  serverVersion?: string;
  sourceLabel?: string;
};

export class McpToolDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolDefinitionError";
  }
}

const sensitiveFieldName = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|card(?:number)?|cvc|cvv|email|phone|ssn|social[_-]?security)/i;
const credentialShape = /(?:sk_(?:test|live|proj)_[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+\/-]{12,})/i;

function containsCredentialShape(value: JsonValue): boolean {
  if (typeof value === "string") return credentialShape.test(value);
  if (Array.isArray(value)) return value.some(containsCredentialShape);
  if (value && typeof value === "object") return Object.values(value).some(containsCredentialShape);
  return false;
}

function containsUnsafeObjectKey(value: unknown, seen = new WeakSet<object>()): string | null {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      const unsafe = containsUnsafeObjectKey(child, seen);
      if (unsafe) return unsafe;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) return key;
    const unsafe = containsUnsafeObjectKey((value as Record<string, unknown>)[key], seen);
    if (unsafe) return unsafe;
  }
  return null;
}

function schemaObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function detectSensitivePaths(schema: JsonObject, prefix = ""): string[] {
  const properties = schemaObject(schema.properties);
  if (!properties) return [];
  const paths: string[] = [];
  for (const [name, definition] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const definitionObject = schemaObject(definition);
    const format = definitionObject?.format;
    if (sensitiveFieldName.test(name) || format === "password" || format === "email") paths.push(path);
    if (definitionObject) {
      paths.push(...detectSensitivePaths(definitionObject, path));
      const items = schemaObject(definitionObject.items);
      if (items) paths.push(...detectSensitivePaths(items, `${path}[]`));
    }
  }
  return [...new Set(paths)].sort();
}

export function findSensitiveMcpInputPaths(inputSchema: JsonObject): string[] {
  return detectSensitivePaths(inputSchema);
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

export function normalizeMcpToolDefinition(
  input: unknown,
  provenance: McpNormalizationProvenance = {}
): NormalizedToolDefinition {
  const unsafeKey = containsUnsafeObjectKey(input);
  if (unsafeKey) {
    throw new McpToolDefinitionError(
      `Invalid MCP tool definition: unsafe property name ${unsafeKey} is not allowed`
    );
  }
  const parsed = mcpToolDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new McpToolDefinitionError(`Invalid MCP tool definition: ${formatIssues(parsed.error)}`);
  }
  if (containsCredentialShape(parsed.data as unknown as JsonValue)) {
    throw new McpToolDefinitionError(
      "Invalid MCP tool definition: credential-shaped values are not allowed in tool metadata or JSON Schema"
    );
  }
  const annotations = parsed.data.annotations
    ? {
        ...(typeof parsed.data.annotations.title === "string"
          ? { title: parsed.data.annotations.title }
          : {}),
        ...(typeof parsed.data.annotations.readOnlyHint === "boolean"
          ? { readOnlyHint: parsed.data.annotations.readOnlyHint }
          : {}),
        ...(typeof parsed.data.annotations.destructiveHint === "boolean"
          ? { destructiveHint: parsed.data.annotations.destructiveHint }
          : {}),
        ...(typeof parsed.data.annotations.idempotentHint === "boolean"
          ? { idempotentHint: parsed.data.annotations.idempotentHint }
          : {}),
        ...(typeof parsed.data.annotations.openWorldHint === "boolean"
          ? { openWorldHint: parsed.data.annotations.openWorldHint }
          : {})
      }
    : undefined;
  const sourceMaterial = {
    sourceKind: "mcp",
    tool: {
      name: parsed.data.name,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
      inputSchema: parsed.data.inputSchema,
      ...(annotations && Object.keys(annotations).length > 0 ? { annotations } : {})
    },
    ...(provenance.serverName ? { serverName: provenance.serverName } : {}),
    ...(provenance.serverVersion ? { serverVersion: provenance.serverVersion } : {}),
    ...(provenance.sourceLabel ? { sourceLabel: provenance.sourceLabel } : {})
  };
  return normalizedToolDefinitionSchema.parse({
    schemaVersion: analysisContractVersion,
    kind: "normalized_tool_definition",
    provenance: {
      sourceKind: "mcp",
      sourceId: digestAnalysisArtifact(sourceMaterial),
      toolName: parsed.data.name,
      ...(provenance.serverName ? { serverName: provenance.serverName } : {}),
      ...(provenance.serverVersion ? { serverVersion: provenance.serverVersion } : {}),
      ...(provenance.sourceLabel ? { sourceLabel: provenance.sourceLabel } : {})
    },
    tool: sourceMaterial.tool,
    normalization: {
      detectedSensitiveFieldPaths: findSensitiveMcpInputPaths(parsed.data.inputSchema),
      warnings: []
    }
  });
}
