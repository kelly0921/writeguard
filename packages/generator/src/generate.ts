import { createHash } from "node:crypto";
import {
  assertGenerationRequestGenerator,
  createGuardGenerationRequest,
  digestAnalysisArtifact,
  generationContractVersion,
  serializeAnalysisArtifact,
  type GeneratorDescriptor,
  type GuardGenerationRequest,
  type GuardGenerationReview,
  type JsonObject,
  type JsonValue,
  type NormalizedToolDefinition,
  type ProposedGuardConfiguration,
  type RiskAnalysisResult
} from "@closure/writeguard/analysis";
import { WriteGuardGeneratorError } from "./errors.js";

export const GENERATOR_ID = "closure.writeguard-generator" as const;
export const GENERATOR_VERSION = "0.3.1" as const;
export const GENERATOR_TEMPLATE_VERSION = "writeguard.typescript-wrapper/v2" as const;
export const GENERATION_MANIFEST_VERSION = "writeguard.generation-manifest/v1" as const;
export const VERIFICATION_BUNDLE_VERSION = "writeguard.verification-bundle/v1" as const;
export const MAX_GENERATION_INPUT_BYTES = 256 * 1024;

export const generatorDescriptor: GeneratorDescriptor = Object.freeze({
  id: GENERATOR_ID,
  version: GENERATOR_VERSION
});

export const supportedGeneratedFailureScenarios = [
  "duplicate_invocation",
  "timeout_after_submission",
  "concurrent_invocations",
  "process_crash_after_effect",
  "reconciliation_unavailable"
] as const;

type SupportedGeneratedFailureScenario = typeof supportedGeneratedFailureScenarios[number];

export type GeneratedArtifact = {
  path: string;
  content: string;
  sha256: string;
};

export type GenerationManifest = {
  schemaVersion: typeof generationContractVersion;
  manifestVersion: typeof GENERATION_MANIFEST_VERSION;
  kind: "writeguard_generation_manifest";
  generator: GeneratorDescriptor;
  templateVersion: typeof GENERATOR_TEMPLATE_VERSION;
  generatedSymbol: string;
  sourceTool: {
    provenance: GuardGenerationReview["binding"]["sourceTool"]["provenance"];
    sourceDigest: string;
  };
  analysis: {
    digest: string;
    contractVersion: string;
    analyzer: GuardGenerationReview["binding"]["analysis"]["analyzer"];
    model: GuardGenerationReview["binding"]["analysis"]["model"];
  };
  developerReview: {
    reviewId: string;
    digest: string;
    reviewer: string;
    reviewedAt: string;
  };
  manifestPath: "writeguard-generation.json";
  verificationBundle: {
    path: "writeguard-verification-bundle.json";
    sha256: string;
  };
  files: Array<{ path: string; sha256: string }>;
  supportedFailureScenarios: string[];
  omittedFailureScenarios: string[];
  developerIntegrationRequirements: string[];
  simulationLimitations: string[];
};

export type GenerationVerificationBundle = {
  schemaVersion: typeof VERIFICATION_BUNDLE_VERSION;
  kind: "writeguard_generation_verification_bundle";
  tool: NormalizedToolDefinition;
  analysis: RiskAnalysisResult;
  review: GuardGenerationReview;
};

export type GeneratedProject = {
  manifest: GenerationManifest;
  files: GeneratedArtifact[];
};

const reservedIdentifiers = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "implements", "import", "in", "instanceof",
  "interface", "let", "new", "null", "package", "private", "protected", "public",
  "return", "static", "super", "switch", "this", "throw", "true", "try", "type",
  "typeof", "var", "void", "while", "with", "yield"
]);

export function sanitizeTypeScriptIdentifier(value: string): string {
  const words = value.normalize("NFKC").split(/[^A-Za-z0-9]+/).filter(Boolean);
  let identifier = words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join("");
  if (!identifier) identifier = "Tool";
  if (/^[0-9]/.test(identifier)) identifier = `_${identifier}`;
  if (reservedIdentifiers.has(identifier.toLowerCase())) identifier = `_${identifier}`;
  return identifier.slice(0, 100);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function jsonObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function assertSupportedSchema(schema: JsonObject, depth = 0, count = { value: 0 }): void {
  if (depth > 8) {
    throw new WriteGuardGeneratorError("Generated TypeScript supports JSON Schemas nested at most eight levels.");
  }
  if (schema.$ref !== undefined || schema.$defs !== undefined || schema.definitions !== undefined) {
    throw new WriteGuardGeneratorError("Generated TypeScript does not support recursive or reference-based schemas.");
  }
  if (schema.oneOf !== undefined || schema.anyOf !== undefined || schema.allOf !== undefined) {
    throw new WriteGuardGeneratorError("Generated TypeScript does not support oneOf, anyOf, or allOf schemas.");
  }
  const properties = jsonObject(schema.properties);
  if (properties) {
    for (const [name, definition] of Object.entries(properties)) {
      count.value += 1;
      if (count.value > 256) {
        throw new WriteGuardGeneratorError("Generated TypeScript supports at most 256 schema properties.");
      }
      if (["__proto__", "prototype", "constructor"].includes(name)) {
        throw new WriteGuardGeneratorError(`Unsafe schema property ${name} was rejected.`);
      }
      const child = jsonObject(definition);
      if (child) {
        assertSupportedSchema(child, depth + 1, count);
        const items = jsonObject(child.items);
        if (items) assertSupportedSchema(items, depth + 1, count);
      }
    }
  }
}

function primitiveLiteral(value: JsonValue): string | null {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  return null;
}

function renderType(schema: JsonObject, depth = 0): string {
  if (depth > 8) throw new WriteGuardGeneratorError("Schema nesting exceeds the supported generation depth.");
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const literals = schema.enum.map(primitiveLiteral);
    if (literals.every((value): value is string => value !== null)) return literals.join(" | ");
  }
  const type = schema.type;
  if (type === "string") return "string";
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";
  if (type === "array") {
    const items = jsonObject(schema.items);
    return items ? `Array<${renderType(items, depth + 1)}>` : "unknown[]";
  }
  const properties = jsonObject(schema.properties);
  if (type === "object" || properties) {
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((item): item is string => typeof item === "string")
        : []
    );
    const members = Object.entries(properties ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, definition]) => {
        const child = jsonObject(definition);
        const optional = required.has(name) ? "" : "?";
        return `  ${JSON.stringify(name)}${optional}: ${child ? renderType(child, depth + 1) : "unknown"};`;
      });
    if (schema.additionalProperties !== false) members.push("  [key: string]: unknown;");
    return `{\n${members.join("\n")}\n}`;
  }
  return "unknown";
}

function sampleValue(schema: JsonObject, name = "value", depth = 0): JsonValue {
  if (depth > 8) return null;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const first = schema.enum[0];
    if (first === null || ["string", "number", "boolean"].includes(typeof first)) return first as JsonValue;
  }
  if (schema.type === "string") {
    return schema.format === "email" ? "sample@example.invalid" : `${name.replaceAll(/[^A-Za-z0-9]/g, "-")}-sample`;
  }
  if (schema.type === "integer" || schema.type === "number") {
    return typeof schema.minimum === "number" && Number.isFinite(schema.minimum) ? schema.minimum : 1;
  }
  if (schema.type === "boolean") return true;
  if (schema.type === "array") {
    const items = jsonObject(schema.items);
    return items ? [sampleValue(items, `${name}-item`, depth + 1)] : [];
  }
  const properties = jsonObject(schema.properties);
  if (schema.type === "object" || properties) {
    const entries = Object.entries(properties ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([propertyName, definition]) => {
        const child = jsonObject(definition);
        return [propertyName, child ? sampleValue(child, propertyName, depth + 1) : null] as const;
      });
    return Object.fromEntries(entries) as JsonObject;
  }
  return null;
}

function literal(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderInput(tool: NormalizedToolDefinition): string {
  return `// Generated by ${GENERATOR_ID}@${GENERATOR_VERSION}. Do not edit without regenerating the manifest.\n` +
    `export type ToolInput = ${renderType(tool.tool.inputSchema)};\n`;
}

function renderConfig(review: GuardGenerationReview, tool: NormalizedToolDefinition): string {
  const selection = review.selection;
  return `// Generated deterministic configuration. Tool descriptions are intentionally excluded.\n` +
    `export const writeGuardConfiguration = Object.freeze(${literal({
      mode: selection.guardConfiguration.approvedMode,
      toolName: tool.tool.name,
      effectType: selection.guardConfiguration.effectType,
      operationIdentity: {
        strategy: selection.operationIdentity.strategy,
        inputFields: selection.operationIdentity.inputFields
      },
      reconciliation: {
        strategy: selection.reconciliation.strategy,
        correlationFields: selection.reconciliation.correlationFields,
        implementation: "developer_supplied_provider_boundary"
      },
      storage: {
        production: "durable_postgresql_required",
        generatedTests: "unsafe_in_memory_only"
      },
      redactionFields: selection.redactionFields,
      failureScenarios: selection.failureScenarios.map((item) => item.scenario)
    })} as const);\n`;
}

function renderProvider(review: GuardGenerationReview): string {
  const applicationKey = review.selection.operationIdentity.strategy === "application_supplied"
    ? "  getOperationKey(input: ToolInput): string;\n"
    : "";
  return `// WRITEGUARD_PROVIDER_BOUNDARY_SCAFFOLD: implement this interface in a separate reviewed file.\n` +
    `import type {\n` +
    `  ExecutionContext,\n` +
    `  ReconciliationContext,\n` +
    `  ReconciliationOutcome,\n` +
    `  VerificationContext\n` +
    `} from "@closure/writeguard";\n` +
    `import type { ToolInput } from "./input.js";\n\n` +
    `/** Real external-effect and reconciliation behavior must be implemented and validated by the developer. */\n` +
    `export interface ProviderBoundary<TResult> {\n` +
    applicationKey +
    `  execute(input: ToolInput, context: ExecutionContext): Promise<TResult>;\n` +
    `  reconcile(input: ToolInput, context: ReconciliationContext): Promise<ReconciliationOutcome<TResult>>;\n` +
    `  verify(result: TResult, input: ToolInput, context: VerificationContext): Promise<boolean>;\n` +
    `  getProviderReference?(result: TResult): string | null;\n` +
    `}\n`;
}

function identitySegments(field: string): string[] {
  if (field.includes("[]")) {
    throw new WriteGuardGeneratorError("Array-valued operation identity is not supported by this generator.");
  }
  return field.split(".");
}

function renderGuardedTool(
  review: GuardGenerationReview,
  analysis: RiskAnalysisResult,
  generatedSymbol: string
): string {
  const proposal = analysis.proposedGuardConfigurations.find(
    (item) => item.id === review.selection.proposalId
  )!;
  const inputPaths = review.selection.operationIdentity.inputFields.map((path) => ({
    path,
    segments: identitySegments(path)
  }));
  const providerLine = proposal.providerAdapter.providerHint
    ? `    provider: ${JSON.stringify(proposal.providerAdapter.providerHint)},\n`
    : "";
  let operationKeyBody: string;
  if (review.selection.operationIdentity.strategy === "application_supplied") {
    operationKeyBody = "provider.getOperationKey(input)";
  } else if (review.selection.operationIdentity.strategy === "field_template") {
    operationKeyBody = "operationKeyFromTemplate(input)";
  } else {
    operationKeyBody = `writeGuardConfiguration.toolName + ":" + JSON.stringify(operationIdentityPaths.map((entry) => [entry.path, readPrimitivePath(input, entry.segments)]))`;
  }
  const fingerprintBody = review.selection.operationIdentity.strategy === "application_supplied"
    ? "input"
    : "Object.fromEntries(operationIdentityPaths.map((entry) => [entry.path, readPrimitivePath(input, entry.segments)]))";
  const templateHelper = review.selection.operationIdentity.strategy === "field_template"
    ? `\nconst operationIdentityTemplate = ${JSON.stringify(review.selection.operationIdentity.template)};\n` +
      `function operationKeyFromTemplate(input: ToolInput): string {\n` +
      `  let key = operationIdentityTemplate;\n` +
      `  for (const entry of operationIdentityPaths) {\n` +
      `    const value = encodeURIComponent(String(readPrimitivePath(input, entry.segments)));\n` +
      `    key = key.replaceAll(\`{\${entry.path}}\`, value);\n` +
      `  }\n` +
      `  if (/\\{[^{}]+\\}/.test(key)) throw new Error("Approved operation identity template contains an unresolved field");\n` +
      `  return writeGuardConfiguration.toolName + ":" + key;\n` +
      `}\n`
    : "";
  return `import type { WriteGuardClient } from "@closure/writeguard";\n` +
    `import { writeGuardConfiguration } from "./config.js";\n` +
    `import type { ToolInput } from "./input.js";\n` +
    `import type { ProviderBoundary } from "./provider.js";\n\n` +
    `const operationIdentityPaths = ${literal(inputPaths)} as const;\n` +
    `function readPrimitivePath(input: ToolInput, segments: readonly string[]): string | number | boolean {\n` +
    `  let current: unknown = input;\n` +
    `  for (const segment of segments) {\n` +
    `    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) {\n` +
    `      throw new Error(\`Missing approved operation identity field \${segments.join(".")}\`);\n` +
    `    }\n` +
    `    current = (current as Record<string, unknown>)[segment];\n` +
    `  }\n` +
    `  if (!["string", "number", "boolean"].includes(typeof current)) {\n` +
    `    throw new Error(\`Operation identity field \${segments.join(".")} must be a primitive value\`);\n` +
    `  }\n` +
    `  return current as string | number | boolean;\n` +
    `}\n` +
    templateHelper +
    `\nexport function create${generatedSymbol}GuardedTool<TResult>(\n` +
    `  writeGuard: WriteGuardClient,\n` +
    `  provider: ProviderBoundary<TResult>\n` +
    `) {\n` +
    `  return writeGuard.guardTool<ToolInput, TResult>({\n` +
    `    name: writeGuardConfiguration.toolName,\n` +
    `    description: "Deterministically generated WriteGuard wrapper; real provider hooks require developer validation.",\n` +
    providerLine +
    `    effectType: writeGuardConfiguration.effectType,\n` +
    `    sensitiveFields: [...writeGuardConfiguration.redactionFields],\n` +
    `    getOperationKey: (input) => ${operationKeyBody},\n` +
    `    getFingerprint: (input) => ${fingerprintBody},\n` +
    `    getMetadata: () => ({ generatedBy: ${JSON.stringify(`${GENERATOR_ID}@${GENERATOR_VERSION}`)}, reviewId: ${JSON.stringify(review.reviewId)} }),\n` +
    `    execute: (input, context) => provider.execute(input, context),\n` +
    `    reconcile: (input, context) => provider.reconcile(input, context),\n` +
    `    verify: (result, input, context) => provider.verify(result, input, context),\n` +
    `    getProviderReference: (result) => provider.getProviderReference?.(result) ?? null\n` +
    `  });\n` +
    `}\n`;
}

function renderFailureTestBlock(scenario: SupportedGeneratedFailureScenario, symbol: string): string {
  if (scenario === "duplicate_invocation") {
    return `test("duplicate request returns one receipt and creates one external effect", async () => {\n` +
      `  await withHarness("success", async ({ guarded, simulator }) => {\n` +
      `    const first = await guarded.invoke(sampleInput, invocation("duplicate-a"));\n` +
      `    const second = await guarded.invoke(sampleInput, invocation("duplicate-b"));\n` +
      `    assert.equal(first.id, second.id);\n` +
      `    assert.equal(simulator.effectCount(), 1);\n` +
      `  });\n` +
      `});\n`;
  }
  if (scenario === "concurrent_invocations") {
    return `test("concurrent invocation creates one external effect", async () => {\n` +
      `  await withHarness("success", async ({ guarded, simulator }) => {\n` +
      `    const [first, second] = await Promise.all([\n` +
      `      guarded.invoke(sampleInput, invocation("concurrent-a")),\n` +
      `      guarded.invoke(sampleInput, invocation("concurrent-b"))\n` +
      `    ]);\n` +
      `    assert.equal(first.id, second.id);\n` +
      `    assert.equal(simulator.effectCount(), 1);\n` +
      `  });\n` +
      `});\n`;
  }
  if (scenario === "reconciliation_unavailable") {
    return `test("delayed reconciliation fails closed, then confirms without a duplicate", async () => {\n` +
      `  await withHarness("delayed", async ({ guarded, simulator }) => {\n` +
      `    await assert.rejects(guarded.invoke(sampleInput, invocation("delayed-a")), UnknownExecutionOutcome);\n` +
      `    await assert.rejects(guarded.invoke(sampleInput, invocation("delayed-b")), ReconciliationFailure);\n` +
      `    simulator.makeVisible();\n` +
      `    const receipt = await guarded.invoke(sampleInput, invocation("delayed-c"));\n` +
      `    assert.equal(receipt.status, "CONFIRMED");\n` +
      `    assert.equal(simulator.effectCount(), 1);\n` +
      `  });\n` +
      `});\n`;
  }
  const title = scenario === "process_crash_after_effect"
    ? "crash after provider success reconciles before retry"
    : "retry after timeout reconciles before retry";
  return `test(${JSON.stringify(title)}, async () => {\n` +
    `  await withHarness("unknown_after_success", async ({ guarded, simulator }) => {\n` +
    `    await assert.rejects(guarded.invoke(sampleInput, invocation("unknown-a")), UnknownExecutionOutcome);\n` +
    `    const receipt = await guarded.invoke(sampleInput, invocation("unknown-b"));\n` +
    `    assert.equal(receipt.status, "CONFIRMED");\n` +
    `    assert.equal(receipt.duplicateExecutionPrevented, true);\n` +
    `    assert.equal(simulator.effectCount(), 1);\n` +
    `  });\n` +
    `});\n`;
}

function renderFailureTests(
  tool: NormalizedToolDefinition,
  review: GuardGenerationReview,
  generatedSymbol: string,
  scenarios: SupportedGeneratedFailureScenario[]
): string {
  const sample = sampleValue(tool.tool.inputSchema);
  const appKeyMember = review.selection.operationIdentity.strategy === "application_supplied"
    ? `    getOperationKey: () => ${JSON.stringify(`${tool.tool.name}:application-supplied-sample`)},\n`
    : "";
  return `import assert from "node:assert/strict";\n` +
    `import test from "node:test";\n` +
    `import {\n` +
    `  ReconciliationFailure,\n` +
    `  UnknownExecutionOutcome,\n` +
    `  createUnsafeInMemoryStorage,\n` +
    `  createWriteGuard,\n` +
    `  type ExecutionContext,\n` +
    `  type ReconciliationContext,\n` +
    `  type VerificationContext\n` +
    `} from "@closure/writeguard";\n` +
    `import { create${generatedSymbol}GuardedTool } from "../src/guarded-tool.js";\n` +
    `import type { ToolInput } from "../src/input.js";\n` +
    `import type { ProviderBoundary } from "../src/provider.js";\n\n` +
    `type SimulatedResult = { id: string; operationKey: string };\n` +
    `type Mode = "success" | "unknown_after_success" | "delayed";\n` +
    `const sampleInput: ToolInput = ${literal(sample)};\n` +
    `const invocation = (toolCallId: string) => ({ framework: "generated-test", toolCallId });\n\n` +
    `function createSimulator(mode: Mode) {\n` +
    `  const records = new Map<string, SimulatedResult>();\n` +
    `  let effects = 0;\n` +
    `  let visible = mode !== "delayed";\n` +
    `  let exposedUnknown = false;\n` +
    `  const provider: ProviderBoundary<SimulatedResult> = {\n` +
    appKeyMember +
    `    async execute(_input: ToolInput, context: ExecutionContext) {\n` +
    `      effects += 1;\n` +
    `      const result = { id: \`effect-\${effects}\`, operationKey: context.operationKey };\n` +
    `      records.set(context.operationKey, result);\n` +
    `      if (mode !== "success" && !exposedUnknown) {\n` +
    `        exposedUnknown = true;\n` +
    `        throw new UnknownExecutionOutcome("simulated unknown outcome after provider success");\n` +
    `      }\n` +
    `      return result;\n` +
    `    },\n` +
    `    async reconcile(_input: ToolInput, context: ReconciliationContext) {\n` +
    `      const result = records.get(context.operationKey);\n` +
    `      if (!visible) return { kind: "unavailable" as const, reason: "simulated delayed visibility", evidence: {} };\n` +
    `      return result\n` +
    `        ? { kind: "found" as const, result, evidence: { simulated: true } }\n` +
    `        : { kind: "not_found" as const, evidence: { simulated: true } };\n` +
    `    },\n` +
    `    async verify(_result: SimulatedResult, _input: ToolInput, _context: VerificationContext) { return true; },\n` +
    `    getProviderReference: (result) => result.id\n` +
    `  };\n` +
    `  return { provider, effectCount: () => effects, makeVisible: () => { visible = true; } };\n` +
    `}\n\n` +
    `async function withHarness(\n` +
    `  mode: Mode,\n` +
    `  run: (value: { guarded: ReturnType<typeof create${generatedSymbol}GuardedTool<SimulatedResult>>; simulator: ReturnType<typeof createSimulator> }) => Promise<void>\n` +
    `) {\n` +
    `  const storage = createUnsafeInMemoryStorage();\n` +
    `  const simulator = createSimulator(mode);\n` +
    `  const writeGuard = createWriteGuard({ storage, namespace: \`generated-\${mode}\`, claimTtlMs: 30_000, waitTimeoutMs: 5_000, pollIntervalMs: 1 });\n` +
    `  const guarded = create${generatedSymbol}GuardedTool(writeGuard, simulator.provider);\n` +
    `  try { await run({ guarded, simulator }); } finally { await storage.close(); }\n` +
    `}\n\n` +
    scenarios.map((scenario) => renderFailureTestBlock(scenario, generatedSymbol)).join("\n");
}

function renderReadme(review: GuardGenerationReview, generatedSymbol: string): string {
  return `# Generated WriteGuard integration\n\n` +
    `This source was generated deterministically from approved review \`${review.reviewId}\`.\n\n` +
    `- Implement \`ProviderBoundary\` with the real provider executor, reconciliation lookup, and verification behavior.\n` +
    `- Create a WriteGuard client with durable PostgreSQL storage for production.\n` +
    `- Call \`create${generatedSymbol}GuardedTool\` and review every generated line before integration.\n` +
    `- Run \`npm run build\` and \`npm test\` after installing dependencies.\n\n` +
    `The generated tests use a deterministic simulated provider. They validate the WriteGuard wrapper's supported failure behavior; they do not prove real provider idempotency, reconciliation, consistency, or verification semantics. No OpenAI dependency or API key is required after analysis.\n`;
}

function artifact(path: string, content: string): GeneratedArtifact {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  return { path, content: normalized, sha256: sha256(normalized) };
}

function createBaseArtifacts(
  tool: NormalizedToolDefinition,
  analysis: RiskAnalysisResult,
  review: GuardGenerationReview,
  generatedSymbol: string,
  scenarios: SupportedGeneratedFailureScenario[]
): GeneratedArtifact[] {
  const generatedPackage = {
    name: "writeguard-generated-integration",
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "npm run build && node --test dist/test/failure.test.js"
    },
    dependencies: { "@closure/writeguard": "^0.8.0" },
    devDependencies: { "@types/node": "^24.0.0", typescript: "^5.8.0" }
  };
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      esModuleInterop: true,
      skipLibCheck: true,
      rootDir: ".",
      outDir: "dist",
      types: ["node"]
    },
    include: ["src/**/*.ts", "test/**/*.ts"]
  };
  return [
    artifact("README.md", renderReadme(review, generatedSymbol)),
    artifact("package.json", serializeAnalysisArtifact(generatedPackage, { pretty: true })),
    artifact("src/config.ts", renderConfig(review, tool)),
    artifact("src/guarded-tool.ts", renderGuardedTool(review, analysis, generatedSymbol)),
    artifact("src/input.ts", renderInput(tool)),
    artifact("src/provider.ts", renderProvider(review)),
    artifact("test/failure.test.ts", renderFailureTests(tool, review, generatedSymbol, scenarios)),
    artifact("tsconfig.json", serializeAnalysisArtifact(tsconfig, { pretty: true }))
  ].sort((left, right) => left.path.localeCompare(right.path));
}

export function generateGuardedToolProject(requestValue: GuardGenerationRequest): GeneratedProject {
  let request: GuardGenerationRequest;
  try {
    request = createGuardGenerationRequest({
      generator: requestValue.generator,
      tool: requestValue.tool,
      analysis: requestValue.analysis,
      review: requestValue.review
    });
    assertGenerationRequestGenerator(request, generatorDescriptor);
  } catch (error) {
    throw new WriteGuardGeneratorError("The approval-bound generation request is invalid.", { cause: error });
  }
  if (Buffer.byteLength(serializeAnalysisArtifact(request), "utf8") > MAX_GENERATION_INPUT_BYTES) {
    throw new WriteGuardGeneratorError(
      `The generation request exceeds the ${MAX_GENERATION_INPUT_BYTES}-byte deterministic input limit.`
    );
  }
  assertSupportedSchema(request.tool.tool.inputSchema);
  const selectedScenarioNames = request.review.selection.failureScenarios.map((item) => item.scenario);
  const supportedSet = new Set<string>(supportedGeneratedFailureScenarios);
  const unsupported = selectedScenarioNames.filter((scenario) => !supportedSet.has(scenario));
  if (unsupported.length > 0) {
    throw new WriteGuardGeneratorError(
      `The approved review requests unsupported generated failure scenarios: ${unsupported.join(", ")}.`
    );
  }
  const selectedScenarios = [...selectedScenarioNames].sort() as SupportedGeneratedFailureScenario[];
  const proposal = request.analysis.proposedGuardConfigurations.find(
    (item) => item.id === request.review.selection.proposalId
  ) as ProposedGuardConfiguration;
  const omittedScenarios = proposal.failureScenarios
    .map((item) => item.scenario)
    .filter((scenario) => !selectedScenarioNames.includes(scenario))
    .sort();
  const generatedSymbol = sanitizeTypeScriptIdentifier(request.tool.tool.name);
  const baseArtifacts = createBaseArtifacts(
    request.tool,
    request.analysis,
    request.review,
    generatedSymbol,
    selectedScenarios
  );
  const verificationBundle: GenerationVerificationBundle = {
    schemaVersion: VERIFICATION_BUNDLE_VERSION,
    kind: "writeguard_generation_verification_bundle",
    tool: request.tool,
    analysis: request.analysis,
    review: request.review
  };
  const verificationBundleArtifact = artifact(
    "writeguard-verification-bundle.json",
    serializeAnalysisArtifact(verificationBundle, { pretty: true })
  );
  const generatedArtifacts = [...baseArtifacts, verificationBundleArtifact]
    .sort((left, right) => left.path.localeCompare(right.path));
  const attestation = request.review.developerAttestation!;
  const manifest: GenerationManifest = {
    schemaVersion: generationContractVersion,
    manifestVersion: GENERATION_MANIFEST_VERSION,
    kind: "writeguard_generation_manifest",
    generator: generatorDescriptor,
    templateVersion: GENERATOR_TEMPLATE_VERSION,
    generatedSymbol,
    sourceTool: {
      provenance: request.tool.provenance,
      sourceDigest: request.review.binding.sourceTool.sourceDigest
    },
    analysis: {
      digest: request.review.binding.analysis.analysisDigest,
      contractVersion: request.review.binding.analysis.contractVersion,
      analyzer: request.analysis.analyzer,
      model: request.review.binding.analysis.model
    },
    developerReview: {
      reviewId: request.review.reviewId,
      digest: digestAnalysisArtifact(request.review),
      reviewer: attestation.reviewer,
      reviewedAt: attestation.reviewedAt
    },
    manifestPath: "writeguard-generation.json",
    verificationBundle: {
      path: "writeguard-verification-bundle.json",
      sha256: verificationBundleArtifact.sha256
    },
    files: generatedArtifacts.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
    supportedFailureScenarios: selectedScenarios,
    omittedFailureScenarios: omittedScenarios,
    developerIntegrationRequirements: [
      "Implement and validate the real provider execution hook.",
      "Implement provider-specific reconciliation with the approved correlation fields.",
      "Implement postcondition verification and provider-reference extraction.",
      "Use durable PostgreSQL storage and run provider-specific failure validation before production."
    ],
    simulationLimitations: [
      "Generated tests validate the WriteGuard integration against a deterministic simulated provider.",
      "They do not prove real provider idempotency, lookup cardinality, consistency, or verification semantics."
    ]
  };
  const manifestArtifact = artifact(
    manifest.manifestPath,
    serializeAnalysisArtifact(manifest, { pretty: true })
  );
  return {
    manifest,
    files: [...generatedArtifacts, manifestArtifact].sort((left, right) => left.path.localeCompare(right.path))
  };
}
