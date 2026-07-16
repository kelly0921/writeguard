import { z } from "zod";

const identifierSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const fieldPathSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_.\[\]-]+$/);
const confidenceSchema = z.number().min(0).max(1);
const reasoningSchema = z.string().min(1).max(4_000);

const evidenceSchema = z.object({
  kind: z.enum(["tool_name", "description", "input_field", "annotation"]),
  reference: z.string().min(1).max(512)
}).strict();

const candidateSchema = z.object({
  id: identifierSchema,
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
  evidence: z.array(evidenceSchema).min(1)
}).strict();

const identitySchema = z.object({
  strategy: z.enum(["field_template", "provider_idempotency_key", "application_supplied"]),
  template: z.string().min(1).max(1_000).nullable(),
  inputFields: z.array(fieldPathSchema),
  confidence: confidenceSchema,
  reasoning: reasoningSchema
}).strict();

const reconciliationSchema = z.object({
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

const failureScenarioSchema = z.object({
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

const proposalSchema = z.object({
  id: identifierSchema,
  candidateOperationId: identifierSchema,
  mode: z.literal("shadow"),
  effectType: z.enum(["reversible_write", "conditionally_reversible", "irreversible_write"]),
  providerAdapter: z.object({
    requirement: z.enum(["existing_adapter", "application_hook", "new_adapter_required"]),
    providerHint: z.string().min(1).max(200).nullable(),
    reasoning: reasoningSchema
  }).strict(),
  operationIdentity: identitySchema,
  reconciliation: reconciliationSchema,
  redaction: z.object({
    fieldPaths: z.array(fieldPathSchema),
    reasoning: reasoningSchema
  }).strict(),
  failureScenarios: z.array(failureScenarioSchema).min(1)
}).strict();

/**
 * Model-facing projection only. Security-sensitive envelope fields are intentionally absent and
 * are attached by trusted code before the public RiskAnalysisResult contract is validated.
 * Nullable fields keep every structured-output property required by the Responses API.
 */
export const modelRiskAnalysisOutputSchema = z.object({
  assessment: z.object({
    riskLevel: z.enum(["none", "low", "medium", "high", "critical"]),
    confidence: confidenceSchema,
    summary: reasoningSchema
  }).strict(),
  candidateOperations: z.array(candidateSchema),
  proposedGuardConfigurations: z.array(proposalSchema),
  limitations: z.array(z.string().min(1).max(2_000))
}).strict();

export type ModelRiskAnalysisOutput = z.infer<typeof modelRiskAnalysisOutputSchema>;
