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
  name: "send_customer_email",
  description: "Send an outbound email to a customer on behalf of a support agent.",
  inputSchema: {
    type: "object",
    properties: {
      tenantId: { type: "string" },
      messageId: { type: "string" },
      recipientEmail: { type: "string", format: "email" },
      subject: { type: "string", maxLength: 200 },
      body: { type: "string", maxLength: 20000 }
    },
    required: ["tenantId", "messageId", "recipientEmail", "subject", "body"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
};

const tool = normalizeMcpToolDefinition(rawTool, {
  serverName: "iteration-4-email-pilot",
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
  reasoning: "Recorded offline email fixture for " + scenario + "."
}));
const analysis = {
  schemaVersion: analysisContractVersion,
  kind: "risk_analysis_result",
  status: "recommendation_only",
  provenance: tool.provenance,
  analyzer: { id: "fixture.iteration-4-email", version: "1.0.0" },
  assessment: {
    riskLevel: "high",
    confidence: 0.94,
    summary: "The tool creates a consequential communication effect."
  },
  candidateOperations: [{
    id: "candidate.email",
    provenance: tool.provenance,
    displayName: "Send customer email",
    operationKind: "external_write",
    consequenceCategories: ["communication"],
    confidence: 0.94,
    reasoning: "The operation sends an external message.",
    evidence: [{ kind: "tool_name", reference: tool.tool.name }]
  }],
  proposedGuardConfigurations: [{
    id: "proposal.email",
    kind: "proposed_guard_configuration",
    reviewState: "requires_developer_approval",
    provenance: tool.provenance,
    candidateOperationId: "candidate.email",
    mode: "shadow",
    effectType: "irreversible_write",
    providerAdapter: {
      requirement: "application_hook",
      reasoning: "The pilot supplies a deterministic simulated email provider boundary."
    },
    operationIdentity: {
      strategy: "field_template",
      template: "{tenantId}:{messageId}",
      inputFields: ["tenantId", "messageId"],
      confidence: 0.92,
      reasoning: "The application message identifier represents send intent, unlike refund order identity."
    },
    reconciliation: {
      strategy: "provider_lookup",
      correlationFields: ["messageId"],
      expectedCardinality: "zero_or_one",
      consistency: "strong",
      confidence: 0.85,
      reasoning: "The simulated provider supports lookup by application message identifier."
    },
    redaction: {
      fieldPaths: ["recipientEmail", "subject", "body"],
      reasoning: "Recipient and message content are excluded from durable receipt material."
    },
    failureScenarios
  }],
  limitations: [
    "This recorded analysis is deterministic offline fixture evidence, not a live model call.",
    "The simulated email provider sends no real email and does not establish real-provider semantics."
  ]
};

const draft = createGuardGenerationReviewDraft(tool, analysis);
draft.selection.guardConfiguration.enforcementAcknowledged = true;
draft.selection.reconciliation.developerSuppliedHookAcknowledged = true;
const review = approveGuardGenerationReview({
  tool,
  analysis,
  review: draft,
  reviewer: "iteration-4-email-maintainer",
  reviewedAt: "2026-07-17T03:05:00.000Z"
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
  join("generated", "provider", "simulated-email.ts"),
  await readFile(join("provider", "simulated-email.ts"), "utf8")
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
  status: "email_generation_complete",
  generatedFiles: project.files.length,
  analyzer: analysis.analyzer,
  liveOpenAICalls: 0
}));
