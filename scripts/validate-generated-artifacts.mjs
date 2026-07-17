import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analysisContractVersion,
  approveGuardGenerationReview,
  createGuardGenerationRequest,
  createGuardGenerationReviewDraft,
  normalizeMcpToolDefinition
} from "@closure/writeguard/analysis";
import {
  generateGuardedToolProject,
  generatorDescriptor,
  publishGeneratedProject
} from "@closure/writeguard-generator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".tmp", "generated-artifact-validation");

function run(command, args, cwd = root) {
  return new Promise((resolveRun, reject) => {
    const child = process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", [command, ...args]
            .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
            .join(" ")],
          { cwd, stdio: "inherit" }
        )
      : spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

const raw = JSON.parse(await readFile(join(root, "fixtures", "mcp-tools", "refund-order.json"), "utf8"));
const tool = normalizeMcpToolDefinition(raw, { sourceLabel: "generated-artifact-validation" });
const failureScenarios = [
  ["duplicate_invocation", "suppress_duplicate"],
  ["timeout_after_submission", "reconcile_before_retry"],
  ["concurrent_invocations", "suppress_duplicate"],
  ["process_crash_after_effect", "reconcile_before_retry"],
  ["reconciliation_unavailable", "fail_closed"]
].map(([scenario, expectedHandling]) => ({
  scenario,
  expectedHandling,
  reasoning: `Generated validation for ${scenario}.`
}));
const analysis = {
  schemaVersion: analysisContractVersion,
  kind: "risk_analysis_result",
  status: "recommendation_only",
  provenance: tool.provenance,
  analyzer: { id: "fixture.generated-validation", version: "1.0.0" },
  assessment: {
    riskLevel: "high",
    confidence: 0.9,
    summary: "The refund fixture creates a consequential financial transaction."
  },
  candidateOperations: [{
    id: "candidate.refund",
    provenance: tool.provenance,
    displayName: "Refund",
    operationKind: "external_write",
    consequenceCategories: ["financial_transaction"],
    confidence: 0.9,
    reasoning: "The tool creates a provider refund.",
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
      reasoning: "A real provider executor and reconciliation hook are required."
    },
    operationIdentity: {
      strategy: "field_template",
      template: "{tenantId}:{orderId}",
      inputFields: ["tenantId", "orderId"],
      confidence: 0.8,
      reasoning: "Tenant and order identify business refund intent for this fixture."
    },
    reconciliation: {
      strategy: "application_ledger",
      correlationFields: [],
      expectedCardinality: "zero_or_one",
      consistency: "unknown",
      confidence: 0.6,
      reasoning: "The generated provider boundary must implement reconciliation."
    },
    redaction: {
      fieldPaths: tool.normalization.detectedSensitiveFieldPaths,
      reasoning: "Detected sensitive fields must be redacted."
    },
    failureScenarios
  }],
  limitations: ["This deterministic analysis fixture does not establish real provider semantics."]
};
const draft = createGuardGenerationReviewDraft(tool, analysis);
draft.selection.guardConfiguration.enforcementAcknowledged = true;
draft.selection.reconciliation.developerSuppliedHookAcknowledged = true;
const review = approveGuardGenerationReview({
  tool,
  analysis,
  review: draft,
  reviewer: "generated-validation",
  reviewedAt: "2026-07-17T02:00:00.000Z"
});
const request = createGuardGenerationRequest({ generator: generatorDescriptor, tool, analysis, review });
const first = generateGuardedToolProject(request);
const second = generateGuardedToolProject(request);
if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error("Identical generation inputs did not produce byte-identical project results");
}

await rm(output, { recursive: true, force: true });
try {
  await publishGeneratedProject(first, { outDir: output });
  await run("pnpm", ["exec", "tsc", "-p", join(output, "tsconfig.json")]);
  await run("node", ["--test", join(output, "dist", "test", "failure.test.js")]);
  const generatedPackage = JSON.parse(await readFile(join(output, "package.json"), "utf8"));
  if (generatedPackage.dependencies?.openai || generatedPackage.devDependencies?.openai) {
    throw new Error("Generated project unexpectedly depends on OpenAI");
  }
  console.log("Generated artifact validation passed: deterministic output, TypeScript compilation, and executable failure tests.");
} finally {
  await rm(output, { recursive: true, force: true });
}
