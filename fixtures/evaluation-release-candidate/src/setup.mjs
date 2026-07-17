import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analysisContractVersion,
  approveGuardGenerationReview,
  createGuardGenerationRequest,
  createGuardGenerationReviewDraft,
  digestAnalysisArtifact,
  normalizeMcpToolDefinition,
  parseRiskAnalysisResult,
  serializeAnalysisArtifact
} from "@closure/writeguard/analysis";
import {
  generateGuardedToolProject,
  generatorDescriptor,
  publishGeneratedProject
} from "@closure/writeguard-generator";

const rawTool = {
  name: "refund_order",
  description: "Create a partial or full refund for a captured order payment.",
  inputSchema: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      orderId: { type: "string" },
      paymentIntentId: { type: "string" },
      amount: { type: "integer", minimum: 1 },
      currency: { type: "string" }
    },
    required: ["tenantId", "orderId", "paymentIntentId", "amount", "currency"],
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false
  }
};

const tool = normalizeMcpToolDefinition(rawTool, {
  serverName: "writeguard-evaluation",
  serverVersion: "1.0.0",
  sourceLabel: "evaluation-release-candidate"
});
const failureScenarios = [
  ["duplicate_invocation", "suppress_duplicate"],
  ["timeout_after_submission", "reconcile_before_retry"],
  ["concurrent_invocations", "suppress_duplicate"],
  ["process_crash_after_effect", "reconcile_before_retry"],
  ["reconciliation_unavailable", "fail_closed"]
].map(([scenario, expectedHandling]) => ({
  scenario,
  expectedHandling,
  reasoning: `Recorded evaluation recommendation for ${scenario}.`
}));
const analysis = parseRiskAnalysisResult({
  schemaVersion: analysisContractVersion,
  kind: "risk_analysis_result",
  status: "recommendation_only",
  provenance: tool.provenance,
  analyzer: {
    id: "openai.gpt-5.6",
    version: "0.1.1"
  },
  assessment: {
    riskLevel: "high",
    confidence: 0.96,
    summary: "The tool creates a consequential external financial effect."
  },
  candidateOperations: [{
    id: "candidate.refund",
    provenance: tool.provenance,
    displayName: "Refund order",
    operationKind: "external_write",
    consequenceCategories: ["financial_transaction"],
    confidence: 0.96,
    reasoning: "A refund changes provider-managed financial state.",
    evidence: [{ kind: "tool_name", reference: tool.tool.name }]
  }],
  proposedGuardConfigurations: [{
    id: "proposal.refund",
    kind: "proposed_guard_configuration",
    reviewState: "requires_developer_approval",
    provenance: tool.provenance,
    candidateOperationId: "candidate.refund",
    mode: "shadow",
    effectType: "conditionally_reversible",
    providerAdapter: {
      requirement: "application_hook",
      reasoning: "A developer must implement and validate provider execution and reconciliation."
    },
    operationIdentity: {
      strategy: "field_template",
      template: "{tenantId}:{orderId}",
      inputFields: ["tenantId", "orderId"],
      confidence: 0.9,
      reasoning: "Tenant and order identify the refund business intention in this fixture."
    },
    reconciliation: {
      strategy: "application_ledger",
      correlationFields: [],
      expectedCardinality: "zero_or_one",
      consistency: "strong",
      confidence: 0.9,
      reasoning: "The deterministic simulated provider exposes a lookup ledger."
    },
    redaction: {
      fieldPaths: ["paymentIntentId"],
      reasoning: "The provider payment reference is excluded from durable diagnostic material."
    },
    failureScenarios
  }],
  limitations: [
    "This is a deterministic recorded evaluation fixture, not a live model call.",
    "The exact live GPT-5.6 payload from the sanitized 9/9 gate was not retained.",
    "The simulated provider does not establish real-provider semantics."
  ]
});

const draft = createGuardGenerationReviewDraft(tool, analysis);
if (
  draft.state !== "draft" ||
  draft.selection.guardConfiguration.enforcementAcknowledged ||
  draft.selection.reconciliation.developerSuppliedHookAcknowledged
) {
  throw new Error("The recorded recommendation unexpectedly implied developer approval.");
}
draft.selection.guardConfiguration.enforcementAcknowledged = true;
draft.selection.reconciliation.developerSuppliedHookAcknowledged = true;
const review = approveGuardGenerationReview({
  tool,
  analysis,
  review: draft,
  reviewer: "evaluation-maintainer",
  reviewedAt: "2026-07-17T12:00:00.000Z"
});
const request = createGuardGenerationRequest({
  generator: generatorDescriptor,
  tool,
  analysis,
  review
});
const project = generateGuardedToolProject(request);
await publishGeneratedProject(project, { outDir: "./generated" });
await mkdir(join("generated", "provider"), { recursive: true });
await writeFile(
  join("generated", "provider", "simulated-refund.ts"),
  await readFile(join("provider", "simulated-refund.ts"), "utf8")
);
await mkdir("artifacts", { recursive: true });
for (const [name, value] of [
  ["normalized-tool.json", tool],
  ["recorded-analysis.json", analysis],
  ["draft-review.json", createGuardGenerationReviewDraft(tool, analysis)],
  ["approved-review.json", review]
]) {
  await writeFile(
    join("artifacts", name),
    `${serializeAnalysisArtifact(value, { pretty: true })}\n`
  );
}

console.log(JSON.stringify({
  status: "evaluation_generation_complete",
  analysis: {
    model: "gpt-5.6",
    source: "recorded_fixture",
    liveCall: false,
    status: analysis.status,
    artifactDigest: digestAnalysisArtifact(analysis)
  },
  developerApproval: {
    state: review.state,
    approvalWasInferred: false,
    reviewDigest: digestAnalysisArtifact(review),
    reviewer: review.developerAttestation.reviewer
  },
  generation: {
    manifestDigest: digestAnalysisArtifact(project.manifest),
    files: project.files.map((file) => file.path)
  },
  networkCalls: {
    openAI: 0,
    stripe: 0,
    otherProviders: 0
  }
}));
