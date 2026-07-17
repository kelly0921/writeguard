import { describe, expect, it } from "vitest";
import {
  digestVerificationPolicyEvaluation,
  evaluateVerificationPolicy,
  parseVerificationPolicy,
  parseVerificationPolicyEvaluation,
  type VerificationPolicy,
  type VerificationReceipt
} from "@closure/writeguard-generator";

const digest = "a".repeat(64);

function receipt(overrides: Partial<VerificationReceipt> = {}): VerificationReceipt {
  const checks: VerificationReceipt["checks"] = [
    "artifact.manifest",
    "artifact.paths_and_digests",
    "artifact.provenance_bindings",
    "artifact.openai_runtime_dependency",
    "artifact.secret_patterns",
    "compilation.public_surfaces"
  ].map((id) => ({
    id,
    level: id.startsWith("compilation") ? "compilation" : "artifact_integrity",
    status: "passed",
    summary: `${id} passed.`,
    diagnostics: []
  }));
  checks.push(
    {
      id: "artifact.extra_files",
      level: "artifact_integrity",
      status: "passed_with_limitations",
      summary: "One provider implementation is outside the generated manifest.",
      diagnostics: []
    },
    {
      id: "tests.generated_failure_behavior",
      level: "simulated_failure_behavior",
      status: "passed_with_limitations",
      summary: "Manifest-owned generated tests passed against a simulation.",
      diagnostics: []
    },
    {
      id: "provider.boundary",
      level: "provider_integration_completeness",
      status: "passed_with_limitations",
      summary: "A provider implementation was supplied and type-compatible.",
      diagnostics: []
    }
  );
  return {
    schemaVersion: "writeguard.verification/v1",
    kind: "writeguard_verification_receipt",
    verifier: {
      id: "closure.writeguard-generator-verifier",
      version: "0.3.1"
    },
    mode: "safe_static_and_generated_tests",
    overallResult: "passed_with_limitations",
    inputs: {
      manifestDigest: digest,
      verificationBundleDigest: digest,
      sourceDigest: digest,
      analysisDigest: digest,
      developerReviewDigest: digest,
      providerFileDigest: digest
    },
    outputs: {
      verifiedFileSetDigest: digest,
      compiledInputDigest: digest,
      generatedTestDigest: digest
    },
    checks,
    levels: [
      {
        level: "artifact_integrity",
        status: "passed_with_limitations",
        verifiedGuarantees: ["Manifest-owned artifacts and bindings passed."],
        limitations: ["The supplied provider file is outside generated-artifact integrity."]
      },
      {
        level: "compilation",
        status: "passed",
        verifiedGuarantees: ["Public-surface compilation passed."],
        limitations: []
      },
      {
        level: "simulated_failure_behavior",
        status: "passed_with_limitations",
        verifiedGuarantees: ["Generated simulated tests passed."],
        limitations: ["Simulation is not real-provider evidence."]
      },
      {
        level: "provider_integration_completeness",
        status: "passed_with_limitations",
        verifiedGuarantees: ["A provider boundary implementation was supplied."],
        limitations: ["Provider semantics were not tested against a real provider."]
      },
      {
        level: "real_provider_semantics",
        status: "not_run",
        verifiedGuarantees: [],
        limitations: ["No provider-specific conformance run occurred."]
      }
    ],
    extraFiles: ["provider/simulated.ts"],
    limitations: [
      {
        code: "simulated_provider_only",
        level: "real_provider_semantics",
        message: "Real-provider semantics were not run.",
        nextAction: "Run provider-specific test-mode conformance."
      }
    ],
    nextActions: ["Run provider-specific test-mode conformance."],
    ...overrides
  };
}

function policy(
  requirements: Partial<VerificationPolicy["requirements"]> = {}
): VerificationPolicy {
  return {
    schemaVersion: "writeguard.verification-policy/v1",
    kind: "writeguard_verification_policy",
    name: "evaluation-release-candidate",
    requirements: {
      artifactIntegrity: "required",
      provenanceBindings: "required",
      controlledCompilation: "required",
      generatedFailureTests: "required",
      providerBoundaryComplete: "required",
      noOpenAIRuntimeDependency: "required",
      noSecretShapedValues: "required",
      realProviderSemantics: "not_required",
      receiptLimitations: "allow_declared",
      ...requirements
    }
  };
}

describe("verification receipt policy", () => {
  it("passes named simulated-evaluation requirements while retaining limitations", () => {
    const evaluation = evaluateVerificationPolicy({ policy: policy(), receipt: receipt() });
    expect(parseVerificationPolicyEvaluation(evaluation)).toEqual(evaluation);
    expect(evaluation.overallResult).toBe("passed");
    expect(evaluation.limitations).toContain("Real-provider semantics were not verified by the source receipt.");
    expect(evaluation.requirements).toContainEqual(expect.objectContaining({
      id: "artifact.integrity",
      status: "satisfied"
    }));
  });

  it("fails a stricter no-limitations policy against the same receipt", () => {
    const evaluation = evaluateVerificationPolicy({
      policy: policy({ receiptLimitations: "forbid" }),
      receipt: receipt()
    });
    expect(evaluation.overallResult).toBe("failed");
    expect(evaluation.requirements).toContainEqual(expect.objectContaining({
      id: "receipt.limitations",
      status: "unsatisfied"
    }));
  });

  it("distinguishes optional and required real-provider evidence", () => {
    const optional = evaluateVerificationPolicy({
      policy: policy({ realProviderSemantics: "optional" }),
      receipt: receipt()
    });
    expect(optional.overallResult).toBe("passed");
    expect(optional.requirements).toContainEqual(expect.objectContaining({
      id: "provider.real_semantics",
      status: "optional_unverified"
    }));

    const required = evaluateVerificationPolicy({
      policy: policy({ realProviderSemantics: "required" }),
      receipt: receipt()
    });
    expect(required.overallResult).toBe("failed");
  });

  it("fails individual evidence requirements when the receipt omits them", () => {
    const withoutSecretScan = receipt({
      checks: receipt().checks.filter((check) => check.id !== "artifact.secret_patterns")
    });
    const evaluation = evaluateVerificationPolicy({
      policy: policy(),
      receipt: withoutSecretScan
    });
    expect(evaluation.overallResult).toBe("failed");
    expect(evaluation.nextActions).toContain("Satisfy policy requirement artifact.secret_patterns.");
  });

  it("fails when the source verification receipt failed", () => {
    const evaluation = evaluateVerificationPolicy({
      policy: policy(),
      receipt: receipt({ overallResult: "failed" })
    });
    expect(evaluation.overallResult).toBe("failed");
    expect(evaluation.requirements[0]).toMatchObject({
      id: "verification.result",
      status: "unsatisfied"
    });
  });

  it("accepts a CLI-style result wrapper and is deterministic", () => {
    const input = {
      policy: policy(),
      receipt: { receipt: receipt(), runtime: { durationMs: 123 } }
    };
    const first = evaluateVerificationPolicy(input);
    const second = evaluateVerificationPolicy(input);
    expect(first).toEqual(second);
    expect(digestVerificationPolicyEvaluation(first)).toBe(
      digestVerificationPolicyEvaluation(second)
    );
  });

  it("rejects invalid and unsupported policy versions at runtime", () => {
    expect(() => parseVerificationPolicy({
      ...policy(),
      schemaVersion: "writeguard.verification-policy/v999"
    })).toThrow();
    expect(() => parseVerificationPolicy({
      ...policy(),
      requirements: { ...policy().requirements, artifactIntegrity: "sometimes" }
    })).toThrow();
  });
});

export { policy as verificationPolicyFixture, receipt as verificationReceiptFixture };
