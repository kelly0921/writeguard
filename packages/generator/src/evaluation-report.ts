import { digestAnalysisArtifact } from "@closure/writeguard/analysis";
import { adapterConformanceReceiptSchema } from "@closure/writeguard/testing";
import { z } from "zod";
import { verificationReceiptSchema } from "./verification-contracts.js";
import { verificationPolicyEvaluationSchema } from "./verification-policy.js";

export const LOCAL_EVALUATION_REPORT_VERSION = "writeguard.local-evaluation/v1" as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const relativePathSchema = z.string().min(1).max(300).superRefine((value, context) => {
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").includes("..")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "evaluation artifact paths must be normalized relative paths"
    });
  }
});

export const localEvaluationReportSchema = z.object({
  schemaVersion: z.literal(LOCAL_EVALUATION_REPORT_VERSION),
  kind: z.literal("writeguard_local_evaluation_report"),
  tool: z.object({
    name: z.string().min(1).max(200),
    consequence: z.literal("simulated_refund")
  }).strict(),
  analysis: z.object({
    model: z.literal("gpt-5.6"),
    source: z.enum(["recorded_fixture", "live"]),
    liveCall: z.boolean(),
    status: z.literal("recommendation_only"),
    artifactDigest: digestSchema,
    evaluationEvidence: z.literal("sanitized_gpt-5.6_gate_9_of_9"),
    exactLivePayloadRetained: z.boolean()
  }).strict().superRefine((value, context) => {
    if ((value.source === "live") !== value.liveCall) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["liveCall"],
        message: "analysis source and live-call status must agree"
      });
    }
    if (value.source === "recorded_fixture" && value.exactLivePayloadRetained) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exactLivePayloadRetained"],
        message: "a deterministic recorded fixture cannot claim retained live payload provenance"
      });
    }
  }),
  developerApproval: z.object({
    state: z.literal("approved"),
    approvalWasInferred: z.literal(false),
    reviewDigest: digestSchema,
    reviewer: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).max(100)
  }).strict(),
  generation: z.object({
    manifestDigest: digestSchema,
    files: z.array(relativePathSchema).min(1).max(128)
  }).strict(),
  effects: z.object({
    unsafeExternalEffects: z.number().int().nonnegative(),
    guardedExternalEffects: z.number().int().nonnegative()
  }).strict(),
  provider: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(100),
    environment: z.enum(["simulated", "test_mode", "production"])
  }).strict(),
  verification: z.object({
    static: verificationReceiptSchema,
    generatedTests: verificationReceiptSchema
  }).strict(),
  policy: verificationPolicyEvaluationSchema,
  adapterConformance: adapterConformanceReceiptSchema,
  cleanConsumer: z.object({
    packedPublicPackages: z.literal(true),
    workspaceAliases: z.literal(false),
    privateImports: z.literal(false),
    postInstallNetworkCalls: z.literal(0),
    postgresqlRequired: z.literal(false)
  }).strict(),
  networkCalls: z.object({
    openAI: z.literal(0),
    stripe: z.literal(0),
    otherProviders: z.literal(0)
  }).strict(),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(30),
  nextIntegrationStep: z.string().min(1).max(500)
}).strict();

export type LocalEvaluationReport = z.infer<typeof localEvaluationReportSchema>;

export function parseLocalEvaluationReport(value: unknown): LocalEvaluationReport {
  return localEvaluationReportSchema.parse(value);
}

export function digestLocalEvaluationReport(value: unknown): string {
  return digestAnalysisArtifact(parseLocalEvaluationReport(value));
}

function bulletList(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

function assertSanitizedSummary(summary: string): void {
  if (
    /sk_(?:test|live)_[A-Za-z0-9]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}/
      .test(summary)
  ) {
    throw new Error("Evaluation summary contains a credential-shaped value.");
  }
  if (/[A-Za-z]:\\Users\\|\/Users\/[^/\s]+\/|file:\/\//i.test(summary)) {
    throw new Error("Evaluation summary contains an absolute user path.");
  }
}

export function renderLocalEvaluationSummary(value: unknown): string {
  const report = parseLocalEvaluationReport(value);
  const testCheck = report.verification.generatedTests.checks.find(
    (check) => check.id === "tests.generated_failure_behavior"
  );
  const realProvider = report.verification.generatedTests.levels.find(
    (level) => level.level === "real_provider_semantics"
  );
  const verified = report.verification.generatedTests.levels
    .flatMap((level) => level.verifiedGuarantees)
    .concat(
      report.adapterConformance.verifiedGuarantees,
      `CI policy ${report.policy.policyName} evaluated ${report.policy.overallResult}.`
    );
  const notVerified = [
    ...report.limitations,
    ...report.verification.generatedTests.limitations.map((limitation) => limitation.message),
    ...report.adapterConformance.limitations
  ];
  const summary = [
    "# WriteGuard local evaluation",
    "",
    "## Outcome",
    "",
    `- Unsafe simulated external effects: ${report.effects.unsafeExternalEffects}`,
    `- Guarded simulated external effects: ${report.effects.guardedExternalEffects}`,
    `- Analysis: ${report.analysis.model}, ${report.analysis.source === "live" ? "live" : "recorded fixture"}, recommendation-only`,
    `- Live model call during this evaluation: ${report.analysis.liveCall ? "yes" : "no"}`,
    `- Developer approval: ${report.developerApproval.state}; inferred: no`,
    `- Generated files: ${report.generation.files.length}`,
    `- Static verification: ${report.verification.static.overallResult}`,
    `- Generated failure tests: ${testCheck?.status ?? "not_run"}`,
    `- Provider: ${report.provider.id} (${report.provider.environment})`,
    `- Adapter conformance: ${report.adapterConformance.overallResult}`,
    `- CI policy: ${report.policy.overallResult}`,
    `- Real-provider semantics: ${realProvider?.status ?? "not_run"}`,
    "",
    "## Generated files",
    "",
    bulletList(report.generation.files),
    "",
    "## Verified",
    "",
    bulletList([...new Set(verified)]),
    "",
    "## Not verified",
    "",
    bulletList([...new Set(notVerified)]),
    "",
    "## Next integration step",
    "",
    report.nextIntegrationStep,
    ""
  ].join("\n");
  assertSanitizedSummary(summary);
  return summary;
}
