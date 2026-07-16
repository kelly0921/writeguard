import { z } from "zod";
import { digestAnalysisArtifact } from "./serialization.js";

export const analysisContractVersion = "writeguard.analysis/v1" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(jsonValueSchema);

const contractVersionSchema = z.literal(analysisContractVersion);
const identifierSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const fieldPathSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_.\[\]-]+$/);
const confidenceSchema = z.number().min(0).max(1);
const reasoningSchema = z.string().min(1).max(4_000);

export const toolProvenanceSchema = z.object({
  sourceKind: z.literal("mcp"),
  sourceId: z.string().regex(/^[a-f0-9]{64}$/),
  toolName: z.string().min(1).max(128),
  serverName: z.string().min(1).max(200).optional(),
  serverVersion: z.string().min(1).max(100).optional(),
  sourceLabel: z.string().min(1).max(200).optional()
}).strict();

export const normalizedToolDefinitionSchema = z.object({
  schemaVersion: contractVersionSchema,
  kind: z.literal("normalized_tool_definition"),
  provenance: toolProvenanceSchema,
  tool: z.object({
    name: z.string().min(1).max(128),
    description: z.string().max(4_096).optional(),
    inputSchema: jsonObjectSchema,
    annotations: z.object({
      title: z.string().min(1).max(200).optional(),
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      openWorldHint: z.boolean().optional()
    }).strict().optional()
  }).strict(),
  normalization: z.object({
    detectedSensitiveFieldPaths: z.array(fieldPathSchema),
    warnings: z.array(z.string().min(1).max(1_000))
  }).strict()
}).strict().superRefine((value, context) => {
  if (value.provenance.toolName !== value.tool.name) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["provenance", "toolName"],
      message: "provenance.toolName must match tool.name"
    });
  }
});

export const analyzerDescriptorSchema = z.object({
  id: identifierSchema,
  version: z.string().min(1).max(100)
}).strict();

export const candidateConsequentialOperationSchema = z.object({
  id: identifierSchema,
  provenance: toolProvenanceSchema,
  displayName: z.string().min(1).max(200),
  operationKind: z.enum(["external_write", "uncertain_external_effect"]),
  consequenceCategories: z.array(z.enum([
    "financial_transaction",
    "communication",
    "data_mutation",
    "infrastructure_change",
    "access_control",
    "other"
  ])).min(1),
  confidence: confidenceSchema,
  reasoning: reasoningSchema,
  evidence: z.array(z.object({
    kind: z.enum(["tool_name", "description", "input_field", "annotation"]),
    reference: z.string().min(1).max(512)
  }).strict()).min(1)
}).strict();

export const proposedOperationIdentitySchema = z.object({
  strategy: z.enum(["field_template", "provider_idempotency_key", "application_supplied"]),
  template: z.string().min(1).max(1_000).optional(),
  inputFields: z.array(fieldPathSchema),
  confidence: confidenceSchema,
  reasoning: reasoningSchema
}).strict().superRefine((value, context) => {
  if (value.strategy === "field_template" && !value.template) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["template"],
      message: "field_template identity requires a template"
    });
  }
  if (value.strategy !== "application_supplied" && value.inputFields.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputFields"],
      message: `${value.strategy} identity requires at least one input field`
    });
  }
});

export const proposedReconciliationStrategySchema = z.object({
  strategy: z.enum([
    "provider_lookup",
    "provider_idempotency_lookup",
    "application_ledger",
    "manual_review_required",
    "unsupported"
  ]),
  correlationFields: z.array(fieldPathSchema),
  expectedCardinality: z.enum(["zero_or_one", "zero_one_or_many", "unknown"]),
  consistency: z.enum(["strong", "eventual", "unknown"]),
  confidence: confidenceSchema,
  reasoning: reasoningSchema
}).strict();

export const proposedFailureScenarioSchema = z.object({
  scenario: z.enum([
    "duplicate_invocation",
    "timeout_before_submission",
    "timeout_after_submission",
    "concurrent_invocations",
    "process_crash_after_effect",
    "reconciliation_unavailable",
    "ambiguous_matches",
    "verification_failure",
    "storage_unavailable"
  ]),
  expectedHandling: z.enum([
    "suppress_duplicate",
    "reconcile_before_retry",
    "fail_closed",
    "require_review",
    "verify_before_confirm"
  ]),
  reasoning: reasoningSchema
}).strict();

export const proposedGuardConfigurationSchema = z.object({
  id: identifierSchema,
  kind: z.literal("proposed_guard_configuration"),
  reviewState: z.literal("requires_developer_approval"),
  provenance: toolProvenanceSchema,
  candidateOperationId: identifierSchema,
  mode: z.enum(["shadow", "enforced"]),
  effectType: z.enum(["reversible_write", "conditionally_reversible", "irreversible_write"]),
  providerAdapter: z.object({
    requirement: z.enum(["existing_adapter", "application_hook", "new_adapter_required"]),
    providerHint: z.string().min(1).max(200).optional(),
    reasoning: reasoningSchema
  }).strict(),
  operationIdentity: proposedOperationIdentitySchema,
  reconciliation: proposedReconciliationStrategySchema,
  redaction: z.object({
    fieldPaths: z.array(fieldPathSchema),
    reasoning: reasoningSchema
  }).strict(),
  failureScenarios: z.array(proposedFailureScenarioSchema).min(1)
}).strict();

export const riskAnalysisResultSchema = z.object({
  schemaVersion: contractVersionSchema,
  kind: z.literal("risk_analysis_result"),
  status: z.literal("recommendation_only"),
  provenance: toolProvenanceSchema,
  analyzer: analyzerDescriptorSchema,
  assessment: z.object({
    riskLevel: z.enum(["none", "low", "medium", "high", "critical"]),
    confidence: confidenceSchema,
    summary: reasoningSchema
  }).strict(),
  candidateOperations: z.array(candidateConsequentialOperationSchema),
  proposedGuardConfigurations: z.array(proposedGuardConfigurationSchema),
  limitations: z.array(z.string().min(1).max(2_000))
}).strict().superRefine((value, context) => {
  const candidateIds = new Set<string>();
  for (const [index, candidate] of value.candidateOperations.entries()) {
    if (candidateIds.has(candidate.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateOperations", index, "id"],
        message: "candidate operation IDs must be unique"
      });
    }
    candidateIds.add(candidate.id);
    if (candidate.provenance.sourceId !== value.provenance.sourceId ||
        candidate.provenance.toolName !== value.provenance.toolName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateOperations", index, "provenance"],
        message: "candidate provenance must match the analyzed tool"
      });
    }
  }
  const proposalIds = new Set<string>();
  for (const [index, proposal] of value.proposedGuardConfigurations.entries()) {
    if (proposalIds.has(proposal.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proposedGuardConfigurations", index, "id"],
        message: "guard proposal IDs must be unique"
      });
    }
    proposalIds.add(proposal.id);
    if (!candidateIds.has(proposal.candidateOperationId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proposedGuardConfigurations", index, "candidateOperationId"],
        message: "guard proposal must reference a candidate operation from this analysis"
      });
    }
    if (proposal.provenance.sourceId !== value.provenance.sourceId ||
        proposal.provenance.toolName !== value.provenance.toolName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proposedGuardConfigurations", index, "provenance"],
        message: "guard proposal provenance must match the analyzed tool"
      });
    }
  }
  if (value.assessment.riskLevel === "none" &&
      (value.candidateOperations.length > 0 || value.proposedGuardConfigurations.length > 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assessment", "riskLevel"],
      message: "riskLevel none cannot include consequential candidates or guard proposals"
    });
  }
});

export const developerReviewSchema = z.object({
  schemaVersion: contractVersionSchema,
  kind: z.literal("developer_review"),
  analysisDigest: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: toolProvenanceSchema,
  decision: z.enum(["pending", "approved", "rejected", "changes_requested"]),
  approvedProposalIds: z.array(identifierSchema),
  reviewer: z.string().min(1).max(200).optional(),
  reviewedAt: z.string().datetime().optional(),
  notes: z.string().max(4_000).optional()
}).strict().superRefine((value, context) => {
  if (value.decision === "pending" && value.approvedProposalIds.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["approvedProposalIds"],
      message: "a pending review cannot approve guard proposals"
    });
  }
  if (value.decision === "approved" && value.approvedProposalIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["approvedProposalIds"],
      message: "an approved review must identify at least one approved proposal"
    });
  }
  if (value.decision !== "pending" && (!value.reviewer || !value.reviewedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reviewer"],
      message: "a completed review requires reviewer and reviewedAt"
    });
  }
});

export type ToolProvenance = z.infer<typeof toolProvenanceSchema>;
export type NormalizedToolDefinition = z.infer<typeof normalizedToolDefinitionSchema>;
export type AnalyzerDescriptor = z.infer<typeof analyzerDescriptorSchema>;
export type CandidateConsequentialOperation = z.infer<typeof candidateConsequentialOperationSchema>;
export type ProposedOperationIdentity = z.infer<typeof proposedOperationIdentitySchema>;
export type ProposedReconciliationStrategy = z.infer<typeof proposedReconciliationStrategySchema>;
export type ProposedFailureScenario = z.infer<typeof proposedFailureScenarioSchema>;
export type ProposedGuardConfiguration = z.infer<typeof proposedGuardConfigurationSchema>;
export type RiskAnalysisResult = z.infer<typeof riskAnalysisResultSchema>;
export type DeveloperReview = z.infer<typeof developerReviewSchema>;

export class AnalysisContractValidationError extends Error {
  constructor(
    readonly artifact: string,
    readonly issues: readonly z.ZodIssue[]
  ) {
    const detail = issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    super(`Invalid ${artifact}: ${detail}`);
    this.name = "AnalysisContractValidationError";
  }
}

function assertVersion(value: unknown, artifact: string): void {
  if (!value || typeof value !== "object") return;
  const version = (value as Record<string, unknown>).schemaVersion;
  if (version !== undefined && version !== analysisContractVersion) {
    throw new AnalysisContractValidationError(artifact, [{
      code: z.ZodIssueCode.custom,
      path: ["schemaVersion"],
      message: `unsupported schema version ${String(version)}; expected ${analysisContractVersion}`
    }]);
  }
}

function parseContract<T>(schema: z.ZodType<T>, value: unknown, artifact: string): T {
  assertVersion(value, artifact);
  const result = schema.safeParse(value);
  if (!result.success) throw new AnalysisContractValidationError(artifact, result.error.issues);
  return result.data;
}

export function parseNormalizedToolDefinition(value: unknown): NormalizedToolDefinition {
  return parseContract(normalizedToolDefinitionSchema, value, "normalized tool definition");
}

export function parseRiskAnalysisResult(value: unknown): RiskAnalysisResult {
  return parseContract(riskAnalysisResultSchema, value, "risk analysis result");
}

export function parseDeveloperReview(value: unknown): DeveloperReview {
  return parseContract(developerReviewSchema, value, "developer review");
}

export function createPendingDeveloperReview(analysis: RiskAnalysisResult): DeveloperReview {
  const validated = parseRiskAnalysisResult(analysis);
  return developerReviewSchema.parse({
    schemaVersion: analysisContractVersion,
    kind: "developer_review",
    analysisDigest: digestAnalysisArtifact(validated),
    provenance: validated.provenance,
    decision: "pending",
    approvedProposalIds: []
  });
}
