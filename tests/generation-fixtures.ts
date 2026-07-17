import {
  analysisContractVersion,
  approveGuardGenerationReview,
  createGuardGenerationRequest,
  createGuardGenerationReviewDraft,
  type GuardGenerationRequest,
  type GuardGenerationReview,
  type NormalizedToolDefinition,
  type ProposedFailureScenario,
  type RiskAnalysisResult
} from "@closure/writeguard/analysis";
import { generatorDescriptor } from "@closure/writeguard-generator";

const supportedScenarios: ProposedFailureScenario[] = [
  {
    scenario: "duplicate_invocation",
    expectedHandling: "suppress_duplicate",
    reasoning: "A duplicate business operation must not create a second external effect."
  },
  {
    scenario: "timeout_after_submission",
    expectedHandling: "reconcile_before_retry",
    reasoning: "An unknown provider outcome must reconcile before any retry."
  },
  {
    scenario: "concurrent_invocations",
    expectedHandling: "suppress_duplicate",
    reasoning: "Concurrent requests for the same operation must converge on one effect."
  },
  {
    scenario: "process_crash_after_effect",
    expectedHandling: "reconcile_before_retry",
    reasoning: "A crash after provider success must reconcile before execution resumes."
  },
  {
    scenario: "reconciliation_unavailable",
    expectedHandling: "fail_closed",
    reasoning: "Unavailable reconciliation must preserve uncertainty without re-execution."
  }
];

export function createGenerationRiskAnalysis(
  tool: NormalizedToolDefinition,
  options: {
    readOnly?: boolean;
    uncertain?: boolean;
    identityFields?: string[];
    identityStrategy?: "field_template" | "provider_idempotency_key" | "application_supplied";
    reconciliation?: "provider_lookup" | "provider_idempotency_lookup" | "application_ledger" | "manual_review_required" | "unsupported";
    reconciliationFields?: string[];
    failureScenarios?: ProposedFailureScenario[];
  } = {}
): RiskAnalysisResult {
  if (options.readOnly) {
    return {
      schemaVersion: analysisContractVersion,
      kind: "risk_analysis_result",
      status: "recommendation_only",
      provenance: tool.provenance,
      analyzer: { id: "fixture.generator", version: "1.0.0" },
      assessment: { riskLevel: "none", confidence: 0.99, summary: "Read-only fixture." },
      candidateOperations: [],
      proposedGuardConfigurations: [],
      limitations: ["Deterministic test fixture."]
    };
  }
  const defaultFields = tool.tool.name.includes("email")
    ? ["tenantId", "messageId"]
    : ["tenantId", "orderId"];
  const identityFields = options.identityFields ?? defaultFields;
  const identityStrategy = options.identityStrategy ?? (identityFields.length === 0
    ? "application_supplied"
    : "field_template");
  const failureScenarios = options.failureScenarios ?? supportedScenarios;
  return {
    schemaVersion: analysisContractVersion,
    kind: "risk_analysis_result",
    status: "recommendation_only",
    provenance: tool.provenance,
    analyzer: { id: "fixture.generator", version: "1.0.0" },
    assessment: {
      riskLevel: "high",
      confidence: options.uncertain ? 0.4 : 0.9,
      summary: "The fixture represents a consequential external write."
    },
    candidateOperations: [{
      id: "candidate.external-write",
      provenance: tool.provenance,
      displayName: "External write",
      operationKind: options.uncertain ? "uncertain_external_effect" : "external_write",
      consequenceCategories: [tool.tool.name.includes("email") ? "communication" : "financial_transaction"],
      confidence: options.uncertain ? 0.4 : 0.9,
      reasoning: "Deterministic fixture candidate.",
      evidence: [{ kind: "tool_name", reference: tool.tool.name }]
    }],
    proposedGuardConfigurations: [{
      id: "proposal.enforced-wrapper",
      kind: "proposed_guard_configuration",
      reviewState: "requires_developer_approval",
      provenance: tool.provenance,
      candidateOperationId: "candidate.external-write",
      mode: "shadow",
      effectType: "conditionally_reversible",
      providerAdapter: {
        requirement: "application_hook",
        reasoning: "The developer must implement the real provider boundary."
      },
      operationIdentity: {
        strategy: identityStrategy,
        ...(identityStrategy === "field_template"
          ? { template: identityFields.map((field) => `{${field}}`).join(":") }
          : {}),
        inputFields: identityFields,
        confidence: identityFields.length > 0 ? 0.8 : 0.2,
        reasoning: identityFields.length > 0
          ? "The selected source fields represent candidate business intent."
          : "The application must supply a stable operation key."
      },
      reconciliation: {
        strategy: options.reconciliation ?? "application_ledger",
        correlationFields: options.reconciliationFields ?? [],
        expectedCardinality: "zero_or_one",
        consistency: "unknown",
        confidence: 0.6,
        reasoning: "The developer must implement and validate this reconciliation hook."
      },
      redaction: {
        fieldPaths: tool.normalization.detectedSensitiveFieldPaths,
        reasoning: "Detected sensitive fields must be redacted."
      },
      failureScenarios
    }],
    limitations: ["Provider semantics remain developer-supplied and unproven by this fixture."]
  };
}

export function acknowledgeReview(
  draft: GuardGenerationReview,
  options: { optionalIdentityFields?: string[]; applicationSupplied?: boolean } = {}
): GuardGenerationReview {
  return {
    ...structuredClone(draft),
    selection: {
      ...structuredClone(draft.selection),
      operationIdentity: {
        ...structuredClone(draft.selection.operationIdentity),
        optionalInputFieldsConfirmed: options.optionalIdentityFields ?? [],
        applicationSuppliedKeyConfirmed: options.applicationSupplied ?? false
      },
      guardConfiguration: {
        ...structuredClone(draft.selection.guardConfiguration),
        enforcementAcknowledged: true
      },
      reconciliation: {
        ...structuredClone(draft.selection.reconciliation),
        developerSuppliedHookAcknowledged: true
      }
    }
  };
}

export function createApprovedGenerationFixture(
  tool: NormalizedToolDefinition,
  analysis = createGenerationRiskAnalysis(tool),
  options: { optionalIdentityFields?: string[]; applicationSupplied?: boolean } = {}
): { analysis: RiskAnalysisResult; review: GuardGenerationReview; request: GuardGenerationRequest } {
  const draft = createGuardGenerationReviewDraft(tool, analysis);
  const review = approveGuardGenerationReview({
    tool,
    analysis,
    review: acknowledgeReview(draft, options),
    reviewer: "fixture-developer",
    reviewedAt: "2026-07-17T01:00:00.000Z"
  });
  return {
    analysis,
    review,
    request: createGuardGenerationRequest({ generator: generatorDescriptor, tool, analysis, review })
  };
}
