import {
  analysisContractVersion,
  type AnalyzerDescriptor,
  type NormalizedToolDefinition,
  type RiskAnalysisResult
} from "@closure/writeguard/analysis";

export const fixtureAnalyzerDescriptor: AnalyzerDescriptor = {
  id: "fixture.test-analyzer",
  version: "1.0.0"
};

export function createFixtureRiskAnalysis(
  tool: NormalizedToolDefinition,
  options: { readOnly?: boolean; analyzer?: AnalyzerDescriptor } = {}
): RiskAnalysisResult {
  const analyzer = options.analyzer ?? fixtureAnalyzerDescriptor;
  if (options.readOnly) {
    return {
      schemaVersion: analysisContractVersion,
      kind: "risk_analysis_result",
      status: "recommendation_only",
      provenance: tool.provenance,
      analyzer,
      assessment: {
        riskLevel: "none",
        confidence: 0.98,
        summary: "Fixture result: the annotated lookup is read-only."
      },
      candidateOperations: [],
      proposedGuardConfigurations: [],
      limitations: ["Fixture result for contract tests only; it is not AI analysis."]
    };
  }
  return {
    schemaVersion: analysisContractVersion,
    kind: "risk_analysis_result",
    status: "recommendation_only",
    provenance: tool.provenance,
    analyzer,
    assessment: {
      riskLevel: "high",
      confidence: 0.9,
      summary: "Fixture result: the tool may create a consequential external effect."
    },
    candidateOperations: [{
      id: "candidate.external-write",
      provenance: tool.provenance,
      displayName: "External write",
      operationKind: "external_write",
      consequenceCategories: ["data_mutation"],
      confidence: 0.9,
      reasoning: "Fixture candidate used to validate the structured contract boundary.",
      evidence: [{ kind: "annotation", reference: "destructiveHint" }]
    }],
    proposedGuardConfigurations: [{
      id: "proposal.shadow-first",
      kind: "proposed_guard_configuration",
      reviewState: "requires_developer_approval",
      provenance: tool.provenance,
      candidateOperationId: "candidate.external-write",
      mode: "shadow",
      effectType: "conditionally_reversible",
      providerAdapter: {
        requirement: "application_hook",
        reasoning: "A developer must supply provider execution, reconciliation, and verification hooks."
      },
      operationIdentity: {
        strategy: "field_template",
        template: "{tenantId}:{operationId}",
        inputFields: ["tenantId", "operationId"],
        confidence: 0.7,
        reasoning: "The developer must confirm these fields represent stable business intent."
      },
      reconciliation: {
        strategy: "provider_lookup",
        correlationFields: ["operationId"],
        expectedCardinality: "zero_one_or_many",
        consistency: "unknown",
        confidence: 0.6,
        reasoning: "Provider lookup behavior must be verified before enforcement."
      },
      redaction: {
        fieldPaths: tool.normalization.detectedSensitiveFieldPaths,
        reasoning: "Deterministically detected sensitive schema fields should be reviewed for redaction."
      },
      failureScenarios: [
        {
          scenario: "duplicate_invocation",
          expectedHandling: "suppress_duplicate",
          reasoning: "The same approved business operation must not execute twice."
        },
        {
          scenario: "timeout_after_submission",
          expectedHandling: "reconcile_before_retry",
          reasoning: "An uncertain submission must reconcile before any later execution."
        }
      ]
    }],
    limitations: ["Fixture result for contract tests only; it is not AI analysis."]
  };
}
