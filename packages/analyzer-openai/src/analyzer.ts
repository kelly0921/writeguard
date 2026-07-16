import {
  AnalysisContractValidationError,
  analysisContractVersion,
  parseNormalizedToolDefinition,
  parseRiskAnalysisResult,
  serializeAnalysisArtifact,
  type AnalyzerDescriptor,
  type JsonObject,
  type JsonValue,
  type NormalizedToolDefinition,
  type RiskAnalysisResult,
  type ToolRiskAnalyzer
} from "@closure/writeguard/analysis";
import { OpenAIAnalyzerError } from "./errors.js";
import {
  modelRiskAnalysisOutputSchema,
  type ModelRiskAnalysisOutput
} from "./model-output.js";
import {
  DEFAULT_OPENAI_ANALYZER_TIMEOUT_MS,
  OPENAI_ANALYZER_MODEL,
  OpenAIResponsesTransport,
  type OpenAIAnalyzerTransport,
  type OpenAIResponsesTransportOptions
} from "./transport.js";

export const OPENAI_ANALYZER_VERSION = "0.1.0" as const;
export const openAIAnalyzerDescriptor: AnalyzerDescriptor = Object.freeze({
  id: "openai.gpt-5.6",
  version: OPENAI_ANALYZER_VERSION
});

export const MAX_OPENAI_ANALYSIS_INPUT_BYTES = 128 * 1024;

export type OpenAIToolRiskAnalyzerOptions = OpenAIResponsesTransportOptions & {
  transport?: OpenAIAnalyzerTransport;
};

function jsonObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function collectInputFieldPaths(schema: JsonObject, prefix = ""): Set<string> {
  const paths = new Set<string>();
  const properties = jsonObject(schema.properties);
  if (!properties) return paths;
  for (const [name, definition] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    paths.add(path);
    const nested = jsonObject(definition);
    if (!nested) continue;
    for (const child of collectInputFieldPaths(nested, path)) paths.add(child);
    const items = jsonObject(nested.items);
    if (items) {
      paths.add(`${path}[]`);
      for (const child of collectInputFieldPaths(items, `${path}[]`)) paths.add(child);
    }
  }
  return paths;
}

function assertFieldPathsExist(paths: readonly string[], available: Set<string>, context: string): void {
  const invalid = paths.filter((path) => !available.has(path));
  if (invalid.length > 0) {
    throw new OpenAIAnalyzerError(
      "unsupported_capability",
      `GPT-5.6 proposed ${context} using fields that are not present in the normalized input schema. No result was accepted.`
    );
  }
}

function hasProviderLookupEvidence(tool: NormalizedToolDefinition): boolean {
  const description = tool.tool.description ?? "";
  return /\b(?:reconcil|lookup|query|retrieve|fetch|check)\w*\b.{0,80}\b(?:operation|request|result|status|idempotenc|provider)\w*\b/i.test(description) ||
    /\b(?:operation|request|result|status|idempotenc|provider)\w*\b.{0,80}\b(?:reconcil|lookup|query|retrieve|fetch|check)\w*\b/i.test(description);
}

function assertPostResponseSafety(
  tool: NormalizedToolDefinition,
  output: ModelRiskAnalysisOutput
): void {
  const available = collectInputFieldPaths(tool.tool.inputSchema);
  const candidateIds = new Set(output.candidateOperations.map((candidate) => candidate.id));
  for (const candidate of output.candidateOperations) {
    for (const evidence of candidate.evidence) {
      if (evidence.kind === "input_field") {
        assertFieldPathsExist([evidence.reference], available, "candidate evidence");
      }
      if (evidence.kind === "tool_name" && evidence.reference !== tool.tool.name) {
        throw new OpenAIAnalyzerError(
          "provenance_mismatch",
          "GPT-5.6 returned candidate evidence for a different tool identity. No result was accepted."
        );
      }
    }
  }
  for (const proposal of output.proposedGuardConfigurations) {
    if (!candidateIds.has(proposal.candidateOperationId)) {
      throw new OpenAIAnalyzerError(
        "schema_validation_failed",
        "GPT-5.6 returned a guard proposal that does not reference this analysis. No result was accepted."
      );
    }
    assertFieldPathsExist(proposal.operationIdentity.inputFields, available, "operation identity");
    assertFieldPathsExist(proposal.reconciliation.correlationFields, available, "reconciliation");
    assertFieldPathsExist(proposal.redaction.fieldPaths, available, "redaction");
    const missingRedaction = tool.normalization.detectedSensitiveFieldPaths.filter(
      (path) => !proposal.redaction.fieldPaths.includes(path)
    );
    if (missingRedaction.length > 0) {
      throw new OpenAIAnalyzerError(
        "unsupported_capability",
        "GPT-5.6 omitted deterministically detected sensitive fields from the proposed redaction policy. No result was accepted."
      );
    }
    if (proposal.operationIdentity.strategy === "provider_idempotency_key" &&
        tool.tool.annotations?.idempotentHint !== true) {
      throw new OpenAIAnalyzerError(
        "unsupported_capability",
        "GPT-5.6 claimed provider idempotency without supporting evidence in the normalized tool. No result was accepted."
      );
    }
    if (["provider_lookup", "provider_idempotency_lookup"].includes(proposal.reconciliation.strategy) &&
        !hasProviderLookupEvidence(tool)) {
      throw new OpenAIAnalyzerError(
        "unsupported_capability",
        "GPT-5.6 proposed provider reconciliation without explicit lookup evidence. Use unsupported or manual review until a developer supplies that capability."
      );
    }
    if (proposal.providerAdapter.requirement === "existing_adapter") {
      throw new OpenAIAnalyzerError(
        "unsupported_capability",
        "An MCP tool definition cannot prove that a compatible WriteGuard provider adapter is installed. No result was accepted."
      );
    }
  }
}

function attachTrustedEnvelope(
  tool: NormalizedToolDefinition,
  output: ModelRiskAnalysisOutput
): RiskAnalysisResult {
  return parseRiskAnalysisResult({
    schemaVersion: analysisContractVersion,
    kind: "risk_analysis_result",
    status: "recommendation_only",
    provenance: tool.provenance,
    analyzer: openAIAnalyzerDescriptor,
    assessment: output.assessment,
    candidateOperations: output.candidateOperations.map((candidate) => ({
      ...candidate,
      provenance: tool.provenance
    })),
    proposedGuardConfigurations: output.proposedGuardConfigurations.map((proposal) => ({
      id: proposal.id,
      kind: "proposed_guard_configuration",
      reviewState: "requires_developer_approval",
      provenance: tool.provenance,
      candidateOperationId: proposal.candidateOperationId,
      mode: proposal.mode,
      effectType: proposal.effectType,
      providerAdapter: {
        requirement: proposal.providerAdapter.requirement,
        ...(proposal.providerAdapter.providerHint === null
          ? {}
          : { providerHint: proposal.providerAdapter.providerHint }),
        reasoning: proposal.providerAdapter.reasoning
      },
      operationIdentity: {
        strategy: proposal.operationIdentity.strategy,
        ...(proposal.operationIdentity.template === null
          ? {}
          : { template: proposal.operationIdentity.template }),
        inputFields: proposal.operationIdentity.inputFields,
        confidence: proposal.operationIdentity.confidence,
        reasoning: proposal.operationIdentity.reasoning
      },
      reconciliation: proposal.reconciliation,
      redaction: proposal.redaction,
      failureScenarios: proposal.failureScenarios
    })),
    limitations: output.limitations
  });
}

export class OpenAIToolRiskAnalyzer implements ToolRiskAnalyzer {
  readonly descriptor = openAIAnalyzerDescriptor;
  readonly transport: OpenAIAnalyzerTransport;
  readonly timeoutMs: number;

  constructor(options: OpenAIToolRiskAnalyzerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OPENAI_ANALYZER_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 120_000) {
      throw new OpenAIAnalyzerError(
        "invalid_configuration",
        "timeoutMs must be an integer from 1000 through 120000 milliseconds."
      );
    }
    if (options.transport && options.client) {
      throw new OpenAIAnalyzerError(
        "invalid_configuration",
        "Provide either a transport or an OpenAI client, not both."
      );
    }
    this.transport = options.transport ?? new OpenAIResponsesTransport(options);
  }

  async analyze(input: NormalizedToolDefinition): Promise<RiskAnalysisResult> {
    let tool: NormalizedToolDefinition;
    try {
      tool = parseNormalizedToolDefinition(input);
    } catch (error) {
      if (error instanceof AnalysisContractValidationError && error.message.includes("unsupported schema version")) {
        throw new OpenAIAnalyzerError(
          "unsupported_contract_version",
          `The analyzer accepts only ${analysisContractVersion} normalized tools. Normalize the input with the matching @closure/writeguard version.`,
          { cause: error }
        );
      }
      throw new OpenAIAnalyzerError(
        "schema_validation_failed",
        "The OpenAI analyzer accepts only a validated normalized WriteGuard tool definition.",
        { cause: error }
      );
    }
    if (Buffer.byteLength(serializeAnalysisArtifact(tool), "utf8") > MAX_OPENAI_ANALYSIS_INPUT_BYTES) {
      throw new OpenAIAnalyzerError(
        "input_too_large",
        `The normalized tool exceeds the ${MAX_OPENAI_ANALYSIS_INPUT_BYTES}-byte analysis limit. Remove large examples or defaults before sending metadata to OpenAI.`
      );
    }
    const response = await this.transport.analyze({
      model: OPENAI_ANALYZER_MODEL,
      tool,
      timeoutMs: this.timeoutMs
    });
    if (response.model !== OPENAI_ANALYZER_MODEL && !response.model.startsWith(`${OPENAI_ANALYZER_MODEL}-`)) {
      throw new OpenAIAnalyzerError(
        "model_identity_mismatch",
        "OpenAI returned a model identity other than gpt-5.6. No fallback result was accepted."
      );
    }
    if (response.kind === "refusal") {
      throw new OpenAIAnalyzerError(
        "refusal",
        "GPT-5.6 refused the analysis request. No recommendation was produced or accepted."
      );
    }
    if (response.kind === "incomplete") {
      const reason = ["max_output_tokens", "content_filter"].includes(response.reason)
        ? response.reason
        : "unknown";
      throw new OpenAIAnalyzerError(
        "incomplete_output",
        `GPT-5.6 returned an incomplete response (${reason}). No partial recommendation was accepted.`
      );
    }
    const parsed = modelRiskAnalysisOutputSchema.safeParse(response.output);
    if (!parsed.success) {
      throw new OpenAIAnalyzerError(
        "invalid_structured_output",
        "GPT-5.6 output did not match the required recommendation schema. No partial or free-form result was accepted.",
        { cause: parsed.error }
      );
    }
    assertPostResponseSafety(tool, parsed.data);
    try {
      return attachTrustedEnvelope(tool, parsed.data);
    } catch (error) {
      throw new OpenAIAnalyzerError(
        "schema_validation_failed",
        "GPT-5.6 returned a recommendation that failed the public WriteGuard analysis contract. No result was accepted.",
        { cause: error }
      );
    }
  }
}

export function createOpenAIToolRiskAnalyzer(
  options: OpenAIToolRiskAnalyzerOptions = {}
): OpenAIToolRiskAnalyzer {
  return new OpenAIToolRiskAnalyzer(options);
}
