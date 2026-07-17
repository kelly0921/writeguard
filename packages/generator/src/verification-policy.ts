import { digestAnalysisArtifact } from "@closure/writeguard/analysis";
import { z } from "zod";
import {
  digestVerificationReceipt,
  parseVerificationReceipt,
  type VerificationCheck,
  type VerificationReceipt
} from "./verification-contracts.js";

export const VERIFICATION_POLICY_VERSION = "writeguard.verification-policy/v1" as const;
export const VERIFICATION_POLICY_EVALUATION_VERSION =
  "writeguard.verification-policy-evaluation/v1" as const;

export const policyRequirementSchema = z.enum(["required", "not_required"]);
export const realProviderPolicyRequirementSchema = z.enum([
  "required",
  "optional",
  "not_required"
]);
export const receiptLimitationsPolicySchema = z.enum(["allow_declared", "forbid"]);

export const verificationPolicySchema = z.object({
  schemaVersion: z.literal(VERIFICATION_POLICY_VERSION),
  kind: z.literal("writeguard_verification_policy"),
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/).max(100),
  requirements: z.object({
    artifactIntegrity: policyRequirementSchema,
    provenanceBindings: policyRequirementSchema,
    controlledCompilation: policyRequirementSchema,
    generatedFailureTests: policyRequirementSchema,
    providerBoundaryComplete: policyRequirementSchema,
    noOpenAIRuntimeDependency: policyRequirementSchema,
    noSecretShapedValues: policyRequirementSchema,
    realProviderSemantics: realProviderPolicyRequirementSchema,
    receiptLimitations: receiptLimitationsPolicySchema
  }).strict()
}).strict();

export const policyEvaluationRequirementSchema = z.object({
  id: z.string().regex(/^[a-z0-9_.-]+$/).max(100),
  policy: z.enum(["required", "optional", "not_required", "forbid", "allow_declared"]),
  status: z.enum(["satisfied", "unsatisfied", "not_required", "optional_unverified"]),
  evidence: z.array(z.string().regex(/^[a-z0-9_.-]+$/).max(100)).max(10),
  summary: z.string().min(1).max(400)
}).strict();

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const verificationPolicyEvaluationSchema = z.object({
  schemaVersion: z.literal(VERIFICATION_POLICY_EVALUATION_VERSION),
  kind: z.literal("writeguard_verification_policy_evaluation"),
  policyName: z.string().min(1).max(100),
  policyDigest: digestSchema,
  verificationReceiptDigest: digestSchema,
  verificationOverallResult: z.enum([
    "passed",
    "failed",
    "passed_with_limitations",
    "not_run",
    "not_applicable"
  ]),
  overallResult: z.enum(["passed", "failed"]),
  requirements: z.array(policyEvaluationRequirementSchema).min(1).max(20),
  limitations: z.array(z.string().min(1).max(400)).max(30),
  nextActions: z.array(z.string().min(1).max(400)).max(20)
}).strict();

export type VerificationPolicy = z.infer<typeof verificationPolicySchema>;
export type VerificationPolicyEvaluation = z.infer<typeof verificationPolicyEvaluationSchema>;
export type PolicyEvaluationRequirement = z.infer<typeof policyEvaluationRequirementSchema>;

export function parseVerificationPolicy(value: unknown): VerificationPolicy {
  return verificationPolicySchema.parse(value);
}

export function parseVerificationPolicyEvaluation(value: unknown): VerificationPolicyEvaluation {
  return verificationPolicyEvaluationSchema.parse(value);
}

export function digestVerificationPolicy(value: unknown): string {
  return digestAnalysisArtifact(parseVerificationPolicy(value));
}

export function digestVerificationPolicyEvaluation(value: unknown): string {
  return digestAnalysisArtifact(parseVerificationPolicyEvaluation(value));
}

export function extractVerificationReceipt(value: unknown): VerificationReceipt {
  if (value && typeof value === "object" && !Array.isArray(value) && "receipt" in value) {
    return parseVerificationReceipt((value as { receipt: unknown }).receipt);
  }
  return parseVerificationReceipt(value);
}

function checkById(receipt: VerificationReceipt, id: string): VerificationCheck | undefined {
  return receipt.checks.find((check) => check.id === id);
}

function fixedRequirement(
  id: string,
  policy: "required" | "not_required",
  satisfied: boolean,
  evidence: string[],
  passedSummary: string,
  failedSummary: string
): PolicyEvaluationRequirement {
  if (policy === "not_required") {
    return {
      id,
      policy,
      status: "not_required",
      evidence,
      summary: "This verification dimension is explicitly not required by the policy."
    };
  }
  return {
    id,
    policy,
    status: satisfied ? "satisfied" : "unsatisfied",
    evidence,
    summary: satisfied ? passedSummary : failedSummary
  };
}

function checkPassed(receipt: VerificationReceipt, id: string): boolean {
  return checkById(receipt, id)?.status === "passed";
}

function checkPassedWithDeclaredLimitations(receipt: VerificationReceipt, id: string): boolean {
  const status = checkById(receipt, id)?.status;
  return status === "passed" || status === "passed_with_limitations";
}

export function evaluateVerificationPolicy(input: {
  policy: unknown;
  receipt: unknown;
}): VerificationPolicyEvaluation {
  const policy = parseVerificationPolicy(input.policy);
  const receipt = extractVerificationReceipt(input.receipt);
  const requirements: PolicyEvaluationRequirement[] = [];
  const artifactLevel = receipt.levels.find((level) => level.level === "artifact_integrity");
  const realProviderLevel = receipt.levels.find((level) => level.level === "real_provider_semantics");
  const providerBoundary = checkById(receipt, "provider.boundary");

  requirements.push(fixedRequirement(
    "verification.result",
    "required",
    receipt.overallResult !== "failed",
    [],
    "The verification receipt did not report a required-check failure.",
    "The verification receipt reports failed verification."
  ));
  requirements.push(fixedRequirement(
    "artifact.integrity",
    policy.requirements.artifactIntegrity,
    artifactLevel?.status === "passed" ||
      (
        policy.requirements.receiptLimitations === "allow_declared" &&
        artifactLevel?.status === "passed_with_limitations" &&
        checkPassed(receipt, "artifact.manifest") &&
        checkPassed(receipt, "artifact.paths_and_digests") &&
        checkPassedWithDeclaredLimitations(receipt, "artifact.extra_files")
      ),
    ["artifact.manifest", "artifact.paths_and_digests"],
    artifactLevel?.status === "passed"
      ? "Artifact integrity passed without extra-file limitations."
      : "Manifest-owned artifact integrity passed; declared extra files remain outside that guarantee.",
    "Required manifest-owned artifact integrity checks did not pass."
  ));
  requirements.push(fixedRequirement(
    "artifact.provenance_bindings",
    policy.requirements.provenanceBindings,
    checkPassed(receipt, "artifact.provenance_bindings"),
    ["artifact.provenance_bindings"],
    "Source, analysis, approved-review, and generator bindings passed.",
    "Required provenance bindings are missing or did not pass."
  ));
  requirements.push(fixedRequirement(
    "compilation.public_surfaces",
    policy.requirements.controlledCompilation,
    checkPassed(receipt, "compilation.public_surfaces"),
    ["compilation.public_surfaces"],
    "Verifier-controlled compilation against public surfaces passed.",
    "Controlled public-surface compilation did not pass."
  ));
  requirements.push(fixedRequirement(
    "tests.generated_failure_behavior",
    policy.requirements.generatedFailureTests,
    checkPassedWithDeclaredLimitations(receipt, "tests.generated_failure_behavior"),
    ["tests.generated_failure_behavior"],
    "The manifest-owned simulated failure tests passed with their declared simulation limitation.",
    "Generated failure tests were not run or did not pass."
  ));
  requirements.push(fixedRequirement(
    "provider.boundary",
    policy.requirements.providerBoundaryComplete,
    checkPassedWithDeclaredLimitations(receipt, "provider.boundary") &&
      !providerBoundary?.diagnostics.some(
        (diagnostic) => diagnostic.code === "provider_implementation_not_supplied"
      ),
    ["provider.boundary"],
    "An explicit provider boundary was present and type-compatible.",
    "The provider boundary remains a scaffold or failed compilation."
  ));
  requirements.push(fixedRequirement(
    "artifact.openai_runtime_dependency",
    policy.requirements.noOpenAIRuntimeDependency,
    checkPassed(receipt, "artifact.openai_runtime_dependency"),
    ["artifact.openai_runtime_dependency"],
    "No OpenAI runtime dependency was found in generated output.",
    "The receipt does not establish the absence of an OpenAI runtime dependency."
  ));
  requirements.push(fixedRequirement(
    "artifact.secret_patterns",
    policy.requirements.noSecretShapedValues,
    checkPassed(receipt, "artifact.secret_patterns"),
    ["artifact.secret_patterns"],
    "No credential-shaped generated value was found.",
    "The receipt does not establish the absence of credential-shaped generated values."
  ));

  const realPolicy = policy.requirements.realProviderSemantics;
  if (realPolicy === "not_required") {
    requirements.push({
      id: "provider.real_semantics",
      policy: realPolicy,
      status: "not_required",
      evidence: ["provider.real_semantics"],
      summary: "Real-provider semantics are explicitly not required by this policy."
    });
  } else if (realPolicy === "optional" && realProviderLevel?.status !== "passed") {
    requirements.push({
      id: "provider.real_semantics",
      policy: realPolicy,
      status: "optional_unverified",
      evidence: ["provider.real_semantics"],
      summary: "Real-provider semantics remain optional and unverified."
    });
  } else {
    const satisfied = realProviderLevel?.status === "passed";
    requirements.push({
      id: "provider.real_semantics",
      policy: realPolicy,
      status: satisfied ? "satisfied" : "unsatisfied",
      evidence: ["provider.real_semantics"],
      summary: satisfied
        ? "The receipt reports passed real-provider semantics."
        : "Required real-provider semantics were not verified."
    });
  }

  const limitationsPolicy = policy.requirements.receiptLimitations;
  const limitationsSatisfied = limitationsPolicy === "allow_declared"
    ? receipt.overallResult !== "failed"
    : receipt.overallResult === "passed" && receipt.limitations.length === 0;
  requirements.push({
    id: "receipt.limitations",
    policy: limitationsPolicy,
    status: limitationsSatisfied ? "satisfied" : "unsatisfied",
    evidence: [],
    summary: limitationsSatisfied
      ? limitationsPolicy === "allow_declared"
        ? "The policy explicitly accepts the receipt's declared limitations."
        : "The receipt contains no limitations."
      : "The policy forbids limitations, but the receipt is limited."
  });

  const failed = requirements.some((requirement) => requirement.status === "unsatisfied");
  const limitations = [
    ...(receipt.overallResult === "passed_with_limitations"
      ? ["The source verification receipt passed with declared limitations."]
      : []),
    ...(checkPassedWithDeclaredLimitations(receipt, "tests.generated_failure_behavior")
      ? ["Generated failure-test evidence is simulated and does not establish real-provider behavior."]
      : []),
    ...(realProviderLevel?.status !== "passed"
      ? ["Real-provider semantics were not verified by the source receipt."]
      : [])
  ];
  const unsatisfied = requirements.filter((requirement) => requirement.status === "unsatisfied");
  return verificationPolicyEvaluationSchema.parse({
    schemaVersion: VERIFICATION_POLICY_EVALUATION_VERSION,
    kind: "writeguard_verification_policy_evaluation",
    policyName: policy.name,
    policyDigest: digestVerificationPolicy(policy),
    verificationReceiptDigest: digestVerificationReceipt(receipt),
    verificationOverallResult: receipt.overallResult,
    overallResult: failed ? "failed" : "passed",
    requirements,
    limitations,
    nextActions: unsatisfied.map((requirement) => `Satisfy policy requirement ${requirement.id}.`)
  });
}
