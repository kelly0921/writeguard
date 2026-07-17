import { describe, expect, it } from "vitest";
import {
  GenerationContractValidationError,
  approveGuardGenerationReview,
  createGuardGenerationRequest,
  createGuardGenerationReviewDraft,
  normalizeMcpToolDefinition,
  parseGuardGenerationReview,
  validateApprovedGuardGenerationReview
} from "@closure/writeguard/analysis";
import { generatorDescriptor } from "@closure/writeguard-generator";
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };
import lookupTool from "../fixtures/mcp-tools/lookup-order.json" with { type: "json" };
import missingIdentityTool from "../fixtures/analyzer-evals/missing-identity.json" with { type: "json" };
import {
  acknowledgeReview,
  createApprovedGenerationFixture,
  createGenerationRiskAnalysis
} from "./generation-fixtures.js";

describe("approval-bound generation contracts", () => {
  it("keeps a created review unapproved and prevents analysis from self-approving", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const analysis = createGenerationRiskAnalysis(tool);
    const draft = createGuardGenerationReviewDraft(tool, analysis);
    expect(draft.state).toBe("draft");
    expect(draft.developerAttestation).toBeUndefined();
    expect(draft.selection.guardConfiguration.enforcementAcknowledged).toBe(false);
    expect(draft.selection.reconciliation.developerSuppliedHookAcknowledged).toBe(false);
    expect(() => validateApprovedGuardGenerationReview({ tool, analysis, review: draft }))
      .toThrow(/separately approved/i);
    expect(() => createGuardGenerationRequest({
      generator: generatorDescriptor,
      tool,
      analysis,
      review: draft
    })).toThrow(/separately approved/i);
    expect(() => createGuardGenerationRequest({
      generator: generatorDescriptor,
      tool,
      analysis,
      review: undefined
    })).toThrow(/invalid guard generation review/i);
  });

  it("requires explicit enforcement and provider-hook acknowledgements before approval", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const analysis = createGenerationRiskAnalysis(tool);
    const draft = createGuardGenerationReviewDraft(tool, analysis);
    expect(() => approveGuardGenerationReview({
      tool,
      analysis,
      review: draft,
      reviewer: "developer"
    })).toThrow(/explicitly acknowledge promotion/i);
    const enforcementOnly = structuredClone(draft);
    enforcementOnly.selection.guardConfiguration.enforcementAcknowledged = true;
    expect(() => approveGuardGenerationReview({
      tool,
      analysis,
      review: enforcementOnly,
      reviewer: "developer"
    })).toThrow(/reconciliation implementation hook/i);
  });

  it("creates an attested approval bound to source, analysis, analyzer, model, and full selection", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const { analysis, review, request } = createApprovedGenerationFixture(tool);
    expect(review).toMatchObject({
      state: "approved",
      binding: {
        sourceTool: { provenance: tool.provenance },
        analysis: {
          contractVersion: analysis.schemaVersion,
          analyzer: analysis.analyzer,
          model: { provider: "not_applicable", model: "none" }
        }
      },
      selection: {
        candidateOperationId: "candidate.external-write",
        proposalId: "proposal.enforced-wrapper",
        guardConfiguration: { approvedMode: "enforced", enforcementAcknowledged: true },
        reconciliation: { developerSuppliedHookAcknowledged: true }
      }
    });
    expect(request.generator).toEqual(generatorDescriptor);
    expect(review.developerAttestation?.reviewer).toBe("fixture-developer");
  });

  it.each([
    ["analysis digest", (review: any) => { review.binding.analysis.analysisDigest = "0".repeat(64); }],
    ["source digest", (review: any) => { review.binding.sourceTool.sourceDigest = "0".repeat(64); }],
    ["tool identity", (review: any) => { review.binding.sourceTool.provenance.toolName = "other_tool"; }],
    ["analyzer identity", (review: any) => { review.binding.analysis.analyzer.id = "other.analyzer"; }],
    ["model identity", (review: any) => { review.binding.analysis.model.model = "other-model"; }]
  ])("rejects a wrong %s binding", (_label, mutate) => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const fixture = createApprovedGenerationFixture(tool);
    const review = structuredClone(fixture.review);
    mutate(review);
    expect(() => validateApprovedGuardGenerationReview({ tool, analysis: fixture.analysis, review }))
      .toThrow(GenerationContractValidationError);
  });

  it("rejects unsupported generation contract versions", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const fixture = createApprovedGenerationFixture(tool);
    expect(() => parseGuardGenerationReview({
      ...fixture.review,
      schemaVersion: "writeguard.generation/v2"
    })).toThrow(/unsupported generation contract version/i);
  });

  it("rejects unknown or unreviewed operation-identity fields", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const analysis = createGenerationRiskAnalysis(tool);
    const draft = acknowledgeReview(createGuardGenerationReviewDraft(tool, analysis));
    draft.selection.operationIdentity.inputFields.push("notInAnalysis");
    expect(() => approveGuardGenerationReview({ tool, analysis, review: draft, reviewer: "developer" }))
      .toThrow(/not present in the analysis/i);

    const analysisWithUnknown = createGenerationRiskAnalysis(tool, {
      identityFields: ["tenantId", "unknownSourceField"]
    });
    const unknownDraft = acknowledgeReview(createGuardGenerationReviewDraft(tool, analysisWithUnknown));
    expect(() => approveGuardGenerationReview({
      tool,
      analysis: analysisWithUnknown,
      review: unknownDraft,
      reviewer: "developer"
    })).toThrow(/do not exist/i);
  });

  it("requires explicit confirmation when an approved identity field is optional", () => {
    const optionalRaw = structuredClone(refundTool) as any;
    optionalRaw.inputSchema.required = optionalRaw.inputSchema.required.filter(
      (field: string) => field !== "orderId"
    );
    const tool = normalizeMcpToolDefinition(optionalRaw);
    const analysis = createGenerationRiskAnalysis(tool);
    const draft = acknowledgeReview(createGuardGenerationReviewDraft(tool, analysis));
    expect(() => approveGuardGenerationReview({ tool, analysis, review: draft, reviewer: "developer" }))
      .toThrow(/optional operation-identity field/i);
    const confirmed = acknowledgeReview(createGuardGenerationReviewDraft(tool, analysis), {
      optionalIdentityFields: ["orderId"]
    });
    expect(approveGuardGenerationReview({
      tool,
      analysis,
      review: confirmed,
      reviewer: "developer",
      reviewedAt: "2026-07-17T01:00:00.000Z"
    }).state).toBe("approved");
  });

  it("rejects unsupported reconciliation and failure capabilities", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const unsupportedAnalysis = createGenerationRiskAnalysis(tool, { reconciliation: "unsupported" });
    const unsupportedReview = acknowledgeReview(
      createGuardGenerationReviewDraft(tool, unsupportedAnalysis)
    );
    expect(() => approveGuardGenerationReview({
      tool,
      analysis: unsupportedAnalysis,
      review: unsupportedReview,
      reviewer: "developer"
    })).toThrow(/unsupported reconciliation/i);

    const analysis = createGenerationRiskAnalysis(tool);
    const draft = acknowledgeReview(createGuardGenerationReviewDraft(tool, analysis));
    const wrongCandidate = structuredClone(draft);
    wrongCandidate.selection.candidateOperationId = "candidate.not-analyzed";
    expect(() => approveGuardGenerationReview({
      tool,
      analysis,
      review: wrongCandidate,
      reviewer: "developer"
    })).toThrow(/does not exist in the analysis/i);
    draft.selection.failureScenarios.push({
      scenario: "verification_failure",
      expectedHandling: "require_review",
      reasoning: "Not present in the analyzed proposal."
    });
    expect(() => approveGuardGenerationReview({ tool, analysis, review: draft, reviewer: "developer" }))
      .toThrow(/was not present unchanged/i);
  });

  it("prevents read-only and uncertain tools from producing enforced generation approval", () => {
    const readOnlyTool = normalizeMcpToolDefinition(lookupTool);
    const readOnlyAnalysis = createGenerationRiskAnalysis(readOnlyTool, { readOnly: true });
    expect(() => createGuardGenerationReviewDraft(readOnlyTool, readOnlyAnalysis))
      .toThrow(/exactly one proposal/i);

    const tool = normalizeMcpToolDefinition(refundTool);
    const uncertainAnalysis = createGenerationRiskAnalysis(tool, { uncertain: true });
    const uncertainReview = acknowledgeReview(createGuardGenerationReviewDraft(tool, uncertainAnalysis));
    expect(() => approveGuardGenerationReview({
      tool,
      analysis: uncertainAnalysis,
      review: uncertainReview,
      reviewer: "developer"
    })).toThrow(/uncertain external effect/i);
  });

  it("requires explicit application-supplied identity resolution for missing identity", () => {
    const tool = normalizeMcpToolDefinition(missingIdentityTool);
    const analysis = createGenerationRiskAnalysis(tool, {
      identityStrategy: "application_supplied",
      identityFields: []
    });
    const draft = acknowledgeReview(createGuardGenerationReviewDraft(tool, analysis));
    expect(() => approveGuardGenerationReview({ tool, analysis, review: draft, reviewer: "developer" }))
      .toThrow(/application-supplied identity requires/i);
    const resolved = acknowledgeReview(createGuardGenerationReviewDraft(tool, analysis), {
      applicationSupplied: true
    });
    expect(approveGuardGenerationReview({
      tool,
      analysis,
      review: resolved,
      reviewer: "developer",
      reviewedAt: "2026-07-17T01:00:00.000Z"
    }).state).toBe("approved");
  });
});
