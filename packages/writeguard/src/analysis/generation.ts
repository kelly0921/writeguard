import { z } from "zod";
import {
  analysisContractVersion,
  analyzerDescriptorSchema,
  parseNormalizedToolDefinition,
  parseRiskAnalysisResult,
  proposedFailureScenarioSchema,
  toolProvenanceSchema,
  type AnalyzerDescriptor,
  type JsonObject,
  type JsonValue,
  type NormalizedToolDefinition,
  type RiskAnalysisResult,
  type ToolProvenance
} from "./contracts.js";
import { digestAnalysisArtifact, serializeAnalysisArtifact } from "./serialization.js";

export const generationContractVersion = "writeguard.generation/v1" as const;
export const developerApprovalAttestation =
  "I reviewed the bound analysis and explicitly approve deterministic generation of the selected enforced guard." as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const fieldPathSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_.\[\]-]+$/);

export const modelIdentitySchema = z.object({
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200)
}).strict();

export const generatorDescriptorSchema = z.object({
  id: identifierSchema,
  version: z.string().min(1).max(100)
}).strict();

const reviewBindingSchema = z.object({
  sourceTool: z.object({
    provenance: toolProvenanceSchema,
    sourceDigest: digestSchema
  }).strict(),
  analysis: z.object({
    contractVersion: z.literal(analysisContractVersion),
    analysisDigest: digestSchema,
    analyzer: analyzerDescriptorSchema,
    model: modelIdentitySchema
  }).strict()
}).strict();

const reviewSelectionSchema = z.object({
  candidateOperationId: identifierSchema,
  proposalId: identifierSchema,
  operationIdentity: z.object({
    strategy: z.enum(["field_template", "provider_idempotency_key", "application_supplied"]),
    template: z.string().min(1).max(1_000).optional(),
    inputFields: z.array(fieldPathSchema),
    optionalInputFieldsConfirmed: z.array(fieldPathSchema),
    applicationSuppliedKeyConfirmed: z.boolean()
  }).strict(),
  guardConfiguration: z.object({
    sourceProposalMode: z.enum(["shadow", "enforced"]),
    approvedMode: z.literal("enforced"),
    enforcementAcknowledged: z.boolean(),
    effectType: z.enum(["reversible_write", "conditionally_reversible", "irreversible_write"]),
    providerAdapterRequirement: z.enum(["existing_adapter", "application_hook", "new_adapter_required"])
  }).strict(),
  reconciliation: z.object({
    strategy: z.enum([
      "provider_lookup",
      "provider_idempotency_lookup",
      "application_ledger",
      "manual_review_required",
      "unsupported"
    ]),
    correlationFields: z.array(fieldPathSchema),
    developerSuppliedHookAcknowledged: z.boolean()
  }).strict(),
  redactionFields: z.array(fieldPathSchema),
  failureScenarios: z.array(proposedFailureScenarioSchema).min(1)
}).strict();

const developerAttestationSchema = z.object({
  reviewer: z.string().min(1).max(200),
  reviewedAt: z.string().datetime(),
  statement: z.literal(developerApprovalAttestation)
}).strict();

export const guardGenerationReviewSchema = z.object({
  schemaVersion: z.literal(generationContractVersion),
  kind: z.literal("guard_generation_review"),
  reviewId: identifierSchema,
  state: z.enum(["draft", "approved"]),
  binding: reviewBindingSchema,
  selection: reviewSelectionSchema,
  developerAttestation: developerAttestationSchema.optional()
}).strict().superRefine((value, context) => {
  if (value.state === "draft" && value.developerAttestation !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["developerAttestation"],
      message: "a draft review cannot contain an approval attestation"
    });
  }
  if (value.state === "approved" && value.developerAttestation === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["developerAttestation"],
      message: "an approved review requires a developer attestation"
    });
  }
});

export const guardGenerationRequestSchema = z.object({
  schemaVersion: z.literal(generationContractVersion),
  kind: z.literal("guard_generation_request"),
  generator: generatorDescriptorSchema,
  tool: z.unknown(),
  analysis: z.unknown(),
  review: z.unknown()
}).strict();

export type ModelIdentity = z.infer<typeof modelIdentitySchema>;
export type GeneratorDescriptor = z.infer<typeof generatorDescriptorSchema>;
export type GuardGenerationReview = z.infer<typeof guardGenerationReviewSchema>;
export type GuardGenerationRequest = z.infer<typeof guardGenerationRequestSchema> & {
  tool: NormalizedToolDefinition;
  analysis: RiskAnalysisResult;
  review: GuardGenerationReview;
};

export class GenerationContractValidationError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GenerationContractValidationError";
  }
}

function sameArtifact(left: unknown, right: unknown): boolean {
  return serializeAnalysisArtifact(left) === serializeAnalysisArtifact(right);
}

export function deriveAnalysisModelIdentity(analyzer: AnalyzerDescriptor): ModelIdentity {
  if (analyzer.id === "openai.gpt-5.6") return { provider: "openai", model: "gpt-5.6" };
  return { provider: "not_applicable", model: "none" };
}

function parseReview(value: unknown): GuardGenerationReview {
  const version = value && typeof value === "object"
    ? (value as Record<string, unknown>).schemaVersion
    : undefined;
  if (version !== undefined && version !== generationContractVersion) {
    throw new GenerationContractValidationError(
      `Unsupported generation contract version ${String(version)}; expected ${generationContractVersion}.`
    );
  }
  const parsed = guardGenerationReviewSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new GenerationContractValidationError(`Invalid guard generation review: ${detail}`, {
      cause: parsed.error
    });
  }
  return parsed.data;
}

export function parseGuardGenerationReview(value: unknown): GuardGenerationReview {
  return parseReview(value);
}

function jsonObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

type FieldInformation = { required: boolean };

function collectFieldInformation(
  schema: JsonObject,
  prefix = "",
  ancestorsRequired = true,
  depth = 0,
  output = new Map<string, FieldInformation>()
): Map<string, FieldInformation> {
  if (depth > 16) {
    throw new GenerationContractValidationError("The source schema exceeds the supported nesting depth of 16.");
  }
  if (schema.$ref !== undefined || schema.$defs !== undefined || schema.definitions !== undefined) {
    throw new GenerationContractValidationError(
      "Recursive or reference-based JSON Schemas are not supported by deterministic generation."
    );
  }
  const properties = jsonObject(schema.properties);
  if (!properties) return output;
  const requiredValue = schema.required;
  const required = new Set(
    Array.isArray(requiredValue)
      ? requiredValue.filter((item): item is string => typeof item === "string")
      : []
  );
  for (const [name, definition] of Object.entries(properties).sort(([left], [right]) => left.localeCompare(right))) {
    if (["__proto__", "prototype", "constructor"].includes(name)) {
      throw new GenerationContractValidationError(
        `The source schema contains the unsafe property name ${name}; generation was refused.`
      );
    }
    const path = prefix ? `${prefix}.${name}` : name;
    const pathRequired = ancestorsRequired && required.has(name);
    output.set(path, { required: pathRequired });
    const child = jsonObject(definition);
    if (!child) continue;
    collectFieldInformation(child, path, pathRequired, depth + 1, output);
    const items = jsonObject(child.items);
    if (items) {
      output.set(`${path}[]`, { required: pathRequired });
      collectFieldInformation(items, `${path}[]`, pathRequired, depth + 1, output);
    }
  }
  return output;
}

function assertUnique(values: readonly string[], context: string): void {
  if (new Set(values).size !== values.length) {
    throw new GenerationContractValidationError(`${context} must not contain duplicate field paths.`);
  }
}

function assertFieldsExist(
  paths: readonly string[],
  fields: Map<string, FieldInformation>,
  context: string
): void {
  const unknown = paths.filter((path) => !fields.has(path));
  if (unknown.length > 0) {
    throw new GenerationContractValidationError(
      `${context} references fields that do not exist in the normalized source schema: ${unknown.join(", ")}.`
    );
  }
}

function assertBoundArtifacts(
  tool: NormalizedToolDefinition,
  analysis: RiskAnalysisResult,
  review: GuardGenerationReview
): void {
  if (!sameArtifact(tool.provenance, analysis.provenance)) {
    throw new GenerationContractValidationError(
      "The analysis provenance does not match the normalized source tool."
    );
  }
  if (!sameArtifact(review.binding.sourceTool.provenance, tool.provenance)) {
    throw new GenerationContractValidationError(
      "The review tool identity does not match the normalized source tool."
    );
  }
  if (review.binding.sourceTool.sourceDigest !== digestAnalysisArtifact(tool)) {
    throw new GenerationContractValidationError("The review source digest does not match the normalized tool.");
  }
  if (review.binding.analysis.analysisDigest !== digestAnalysisArtifact(analysis)) {
    throw new GenerationContractValidationError("The review analysis digest does not match the supplied analysis.");
  }
  if (review.binding.analysis.contractVersion !== analysis.schemaVersion) {
    throw new GenerationContractValidationError("The review analysis contract version is mismatched.");
  }
  if (!sameArtifact(review.binding.analysis.analyzer, analysis.analyzer)) {
    throw new GenerationContractValidationError("The review analyzer identity does not match the analysis.");
  }
  if (!sameArtifact(review.binding.analysis.model, deriveAnalysisModelIdentity(analysis.analyzer))) {
    throw new GenerationContractValidationError("The review model identity does not match the analyzer identity.");
  }
}

function assertSelectionSupported(
  tool: NormalizedToolDefinition,
  analysis: RiskAnalysisResult,
  review: GuardGenerationReview
): void {
  if (analysis.status !== "recommendation_only") {
    throw new GenerationContractValidationError("Only a recommendation-only analysis can enter developer review.");
  }
  const selection = review.selection;
  const candidate = analysis.candidateOperations.find((item) => item.id === selection.candidateOperationId);
  if (!candidate) {
    throw new GenerationContractValidationError("The selected consequential operation does not exist in the analysis.");
  }
  if (candidate.operationKind !== "external_write") {
    throw new GenerationContractValidationError(
      "An uncertain external effect cannot generate an enforced guard until the source and analysis are resolved."
    );
  }
  const proposal = analysis.proposedGuardConfigurations.find((item) => item.id === selection.proposalId);
  if (!proposal || proposal.candidateOperationId !== candidate.id) {
    throw new GenerationContractValidationError(
      "The selected guard proposal does not exist or does not belong to the selected operation."
    );
  }
  if (selection.guardConfiguration.sourceProposalMode !== proposal.mode ||
      selection.guardConfiguration.effectType !== proposal.effectType ||
      selection.guardConfiguration.providerAdapterRequirement !== proposal.providerAdapter.requirement) {
    throw new GenerationContractValidationError(
      "The approved guard configuration attempts to change capabilities from the analyzed proposal."
    );
  }
  if (!selection.guardConfiguration.enforcementAcknowledged) {
    throw new GenerationContractValidationError(
      "The developer must explicitly acknowledge promotion from a recommendation to enforced generation."
    );
  }
  if (selection.operationIdentity.strategy !== proposal.operationIdentity.strategy ||
      selection.operationIdentity.template !== proposal.operationIdentity.template) {
    throw new GenerationContractValidationError(
      "The approved operation-identity strategy does not match the analyzed proposal."
    );
  }
  const proposedIdentityFields = new Set(proposal.operationIdentity.inputFields);
  if (selection.operationIdentity.inputFields.some((field) => !proposedIdentityFields.has(field))) {
    throw new GenerationContractValidationError(
      "The review cannot add operation-identity fields that were not present in the analysis."
    );
  }
  const fields = collectFieldInformation(tool.tool.inputSchema);
  const allSelectedFields = [
    ...selection.operationIdentity.inputFields,
    ...selection.reconciliation.correlationFields,
    ...selection.redactionFields
  ];
  assertUnique(selection.operationIdentity.inputFields, "Operation identity");
  assertUnique(selection.operationIdentity.optionalInputFieldsConfirmed, "Optional identity confirmation");
  assertUnique(selection.reconciliation.correlationFields, "Reconciliation");
  assertUnique(selection.redactionFields, "Redaction");
  assertFieldsExist(allSelectedFields, fields, "The approved review");

  if (selection.operationIdentity.strategy === "application_supplied") {
    if (selection.operationIdentity.inputFields.length > 0 ||
        !selection.operationIdentity.applicationSuppliedKeyConfirmed) {
      throw new GenerationContractValidationError(
        "Application-supplied identity requires empty source fields and explicit approval of a developer-supplied operation-key hook."
      );
    }
  } else {
    if (selection.operationIdentity.inputFields.length === 0) {
      throw new GenerationContractValidationError("An approved source-field identity requires at least one field.");
    }
    if (selection.operationIdentity.applicationSuppliedKeyConfirmed) {
      throw new GenerationContractValidationError(
        "Application-supplied identity confirmation is invalid for a source-field identity."
      );
    }
  }
  if (selection.operationIdentity.strategy === "field_template") {
    const template = selection.operationIdentity.template;
    if (!template) {
      throw new GenerationContractValidationError("A field-template identity requires an approved template.");
    }
    const placeholders = [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!);
    const placeholderSet = new Set(placeholders);
    if (placeholders.length === 0 ||
        selection.operationIdentity.inputFields.some((field) => !placeholderSet.has(field)) ||
        placeholders.some((field) => !selection.operationIdentity.inputFields.includes(field))) {
      throw new GenerationContractValidationError(
        "The approved operation-identity template must reference exactly the approved identity fields."
      );
    }
  }
  const optionalIdentityFields = selection.operationIdentity.inputFields.filter(
    (field) => fields.get(field)?.required !== true
  );
  const confirmedOptionalFields = new Set(selection.operationIdentity.optionalInputFieldsConfirmed);
  if (optionalIdentityFields.some((field) => !confirmedOptionalFields.has(field)) ||
      selection.operationIdentity.optionalInputFieldsConfirmed.some(
        (field) => !optionalIdentityFields.includes(field)
      )) {
    throw new GenerationContractValidationError(
      "Every optional operation-identity field, and only an optional field, requires explicit confirmation."
    );
  }
  const sensitive = new Set([
    ...tool.normalization.detectedSensitiveFieldPaths,
    ...selection.redactionFields
  ]);
  if (selection.operationIdentity.inputFields.some((field) => sensitive.has(field))) {
    throw new GenerationContractValidationError(
      "Sensitive or redacted fields cannot be used as durable operation identity."
    );
  }
  if (selection.reconciliation.strategy !== proposal.reconciliation.strategy ||
      !sameArtifact(
        [...selection.reconciliation.correlationFields].sort(),
        [...proposal.reconciliation.correlationFields].sort()
      )) {
    throw new GenerationContractValidationError(
      "The approved reconciliation strategy must match the analyzed proposal."
    );
  }
  if (selection.reconciliation.strategy === "unsupported") {
    throw new GenerationContractValidationError(
      "Generation is unavailable for an unsupported reconciliation strategy."
    );
  }
  if (!selection.reconciliation.developerSuppliedHookAcknowledged) {
    throw new GenerationContractValidationError(
      "The developer must explicitly acknowledge the required reconciliation implementation hook."
    );
  }
  const proposedRedactions = new Set(proposal.redaction.fieldPaths);
  if ([...proposedRedactions].some((field) => !selection.redactionFields.includes(field)) ||
      tool.normalization.detectedSensitiveFieldPaths.some(
        (field) => !selection.redactionFields.includes(field)
      )) {
    throw new GenerationContractValidationError(
      "The approved redaction policy cannot omit analyzed or deterministically detected sensitive fields."
    );
  }
  const proposedScenarios = new Map(
    proposal.failureScenarios.map((scenario) => [scenario.scenario, scenario] as const)
  );
  const selectedScenarioNames = selection.failureScenarios.map((scenario) => scenario.scenario);
  if (new Set(selectedScenarioNames).size !== selectedScenarioNames.length) {
    throw new GenerationContractValidationError("Approved failure scenarios must be unique.");
  }
  for (const scenario of selection.failureScenarios) {
    const proposed = proposedScenarios.get(scenario.scenario);
    if (!proposed || !sameArtifact(proposed, scenario)) {
      throw new GenerationContractValidationError(
        `The approved ${scenario.scenario} failure scenario was not present unchanged in the analysis.`
      );
    }
  }
}

function validateReviewAgainstArtifacts(
  toolValue: unknown,
  analysisValue: unknown,
  reviewValue: unknown
): { tool: NormalizedToolDefinition; analysis: RiskAnalysisResult; review: GuardGenerationReview } {
  const tool = parseNormalizedToolDefinition(toolValue);
  const analysis = parseRiskAnalysisResult(analysisValue);
  const review = parseReview(reviewValue);
  assertBoundArtifacts(tool, analysis, review);
  assertSelectionSupported(tool, analysis, review);
  return { tool, analysis, review };
}

export function createGuardGenerationReviewDraft(
  toolValue: unknown,
  analysisValue: unknown,
  options: { proposalId?: string } = {}
): GuardGenerationReview {
  const tool = parseNormalizedToolDefinition(toolValue);
  const analysis = parseRiskAnalysisResult(analysisValue);
  if (!sameArtifact(tool.provenance, analysis.provenance)) {
    throw new GenerationContractValidationError(
      "The analysis provenance does not match the normalized source tool."
    );
  }
  const proposals = options.proposalId
    ? analysis.proposedGuardConfigurations.filter((proposal) => proposal.id === options.proposalId)
    : analysis.proposedGuardConfigurations;
  if (proposals.length !== 1) {
    throw new GenerationContractValidationError(
      options.proposalId
        ? `The requested proposal ${options.proposalId} was not found exactly once.`
        : "Review creation requires exactly one proposal; select one explicitly with its proposal ID."
    );
  }
  const proposal = proposals[0]!;
  const candidate = analysis.candidateOperations.find(
    (item) => item.id === proposal.candidateOperationId
  );
  if (!candidate) {
    throw new GenerationContractValidationError("The selected proposal does not reference a valid operation.");
  }
  const identityFields = [...proposal.operationIdentity.inputFields];
  const reviewSeed = {
    sourceDigest: digestAnalysisArtifact(tool),
    analysisDigest: digestAnalysisArtifact(analysis),
    candidateOperationId: candidate.id,
    proposalId: proposal.id
  };
  return parseReview({
    schemaVersion: generationContractVersion,
    kind: "guard_generation_review",
    reviewId: `review.${digestAnalysisArtifact(reviewSeed).slice(0, 32)}`,
    state: "draft",
    binding: {
      sourceTool: {
        provenance: tool.provenance,
        sourceDigest: reviewSeed.sourceDigest
      },
      analysis: {
        contractVersion: analysis.schemaVersion,
        analysisDigest: reviewSeed.analysisDigest,
        analyzer: analysis.analyzer,
        model: deriveAnalysisModelIdentity(analysis.analyzer)
      }
    },
    selection: {
      candidateOperationId: candidate.id,
      proposalId: proposal.id,
      operationIdentity: {
        strategy: proposal.operationIdentity.strategy,
        ...(proposal.operationIdentity.template
          ? { template: proposal.operationIdentity.template }
          : {}),
        inputFields: identityFields,
        optionalInputFieldsConfirmed: [],
        applicationSuppliedKeyConfirmed: false
      },
      guardConfiguration: {
        sourceProposalMode: proposal.mode,
        approvedMode: "enforced",
        enforcementAcknowledged: false,
        effectType: proposal.effectType,
        providerAdapterRequirement: proposal.providerAdapter.requirement
      },
      reconciliation: {
        strategy: proposal.reconciliation.strategy,
        correlationFields: [...proposal.reconciliation.correlationFields],
        developerSuppliedHookAcknowledged: false
      },
      redactionFields: [...new Set([
        ...proposal.redaction.fieldPaths,
        ...tool.normalization.detectedSensitiveFieldPaths
      ])].sort(),
      failureScenarios: [...proposal.failureScenarios].sort((left, right) =>
        left.scenario.localeCompare(right.scenario)
      )
    }
  });
}

export function approveGuardGenerationReview(options: {
  tool: unknown;
  analysis: unknown;
  review: unknown;
  reviewer: string;
  reviewedAt?: string;
}): GuardGenerationReview {
  const parsed = validateReviewAgainstArtifacts(options.tool, options.analysis, options.review);
  if (parsed.review.state !== "draft") {
    throw new GenerationContractValidationError("Only a draft review can be approved.");
  }
  const approved = parseReview({
    ...parsed.review,
    state: "approved",
    developerAttestation: {
      reviewer: options.reviewer,
      reviewedAt: options.reviewedAt ?? new Date().toISOString(),
      statement: developerApprovalAttestation
    }
  });
  validateReviewAgainstArtifacts(parsed.tool, parsed.analysis, approved);
  return approved;
}

export function validateApprovedGuardGenerationReview(options: {
  tool: unknown;
  analysis: unknown;
  review: unknown;
}): { tool: NormalizedToolDefinition; analysis: RiskAnalysisResult; review: GuardGenerationReview } {
  const review = parseReview(options.review);
  if (review.state !== "approved" || !review.developerAttestation) {
    throw new GenerationContractValidationError(
      "Generation requires a separately approved, attested developer review; recommendation-only analysis cannot approve itself."
    );
  }
  return validateReviewAgainstArtifacts(options.tool, options.analysis, review);
}

export function createGuardGenerationRequest(options: {
  generator: GeneratorDescriptor;
  tool: unknown;
  analysis: unknown;
  review: unknown;
}): GuardGenerationRequest {
  const bound = validateApprovedGuardGenerationReview(options);
  const generator = generatorDescriptorSchema.parse(options.generator);
  return {
    schemaVersion: generationContractVersion,
    kind: "guard_generation_request",
    generator,
    ...bound
  };
}

export function assertGenerationRequestGenerator(
  request: GuardGenerationRequest,
  expected: GeneratorDescriptor
): void {
  if (!sameArtifact(request.generator, expected)) {
    throw new GenerationContractValidationError(
      "The generation request is bound to a different generator identity or version."
    );
  }
}

export function sourceFieldInformation(tool: NormalizedToolDefinition): ReadonlyMap<string, FieldInformation> {
  return collectFieldInformation(tool.tool.inputSchema);
}

export type { FieldInformation, ToolProvenance };
