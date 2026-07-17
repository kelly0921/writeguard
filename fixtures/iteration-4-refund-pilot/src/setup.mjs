import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analysisContractVersion,
  approveGuardGenerationReview,
  createGuardGenerationRequest,
  createGuardGenerationReviewDraft,
  normalizeMcpToolDefinition,
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
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
};

const tool = normalizeMcpToolDefinition(rawTool, {
  serverName: "iteration-4-refund-pilot",
  serverVersion: "1.0.0",
  sourceLabel: "packed-external-consumer"
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
  reasoning: "Recorded offline refund fixture for " + scenario + "."
}));
const analysis = {
  schemaVersion: analysisContractVersion,
  kind: "risk_analysis_result",
  status: "recommendation_only",
  provenance: tool.provenance,
  analyzer: { id: "fixture.iteration-4-refund", version: "1.0.0" },
  assessment: {
    riskLevel: "high",
    confidence: 0.96,
    summary: "The tool creates a consequential financial effect."
  },
  candidateOperations: [{
    id: "candidate.refund",
    provenance: tool.provenance,
    displayName: "Refund order",
    operationKind: "external_write",
    consequenceCategories: ["financial_transaction"],
    confidence: 0.96,
    reasoning: "A refund changes external financial state.",
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
      reasoning: "The pilot supplies a deterministic simulated provider boundary."
    },
    operationIdentity: {
      strategy: "field_template",
      template: "{tenantId}:{orderId}",
      inputFields: ["tenantId", "orderId"],
      confidence: 0.9,
      reasoning: "Tenant and order identify refund business intent in this fixture."
    },
    reconciliation: {
      strategy: "application_ledger",
      correlationFields: [],
      expectedCardinality: "zero_or_one",
      consistency: "strong",
      confidence: 0.9,
      reasoning: "The simulated pilot ledger supports deterministic lookup."
    },
    redaction: {
      fieldPaths: ["paymentIntentId"],
      reasoning: "Provider payment identifiers are excluded from durable receipt material."
    },
    failureScenarios
  }],
  limitations: [
    "This recorded analysis is deterministic offline fixture evidence, not a live model call.",
    "The simulated refund provider is not Stripe and does not establish real-provider semantics."
  ]
};

const draft = createGuardGenerationReviewDraft(tool, analysis);
draft.selection.guardConfiguration.enforcementAcknowledged = true;
draft.selection.reconciliation.developerSuppliedHookAcknowledged = true;
const review = approveGuardGenerationReview({
  tool,
  analysis,
  review: draft,
  reviewer: "iteration-4-refund-maintainer",
  reviewedAt: "2026-07-17T03:00:00.000Z"
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
  ["analysis.json", analysis],
  ["approved-review.json", review]
]) {
  await writeFile(join("artifacts", name), serializeAnalysisArtifact(value, { pretty: true }) + "\n");
}
console.log(JSON.stringify({
  status: "refund_generation_complete",
  generatedFiles: project.files.length,
  analyzer: analysis.analyzer,
  liveOpenAICalls: 0
}));
