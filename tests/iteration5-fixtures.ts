import type {
  AdapterConformanceReceipt
} from "@closure/writeguard/testing";
import {
  evaluateVerificationPolicy,
  type LocalEvaluationReport,
  type VerificationPolicy,
  type VerificationReceipt
} from "@closure/writeguard-generator";

const digest = "b".repeat(64);

export function iteration5VerificationReceipt(): VerificationReceipt {
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
      summary: "The provider implementation is outside the generated manifest.",
      diagnostics: []
    },
    {
      id: "tests.generated_failure_behavior",
      level: "simulated_failure_behavior",
      status: "passed_with_limitations",
      summary: "Generated simulated tests passed.",
      diagnostics: []
    },
    {
      id: "provider.boundary",
      level: "provider_integration_completeness",
      status: "passed_with_limitations",
      summary: "A provider implementation was type-compatible.",
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
        verifiedGuarantees: ["Manifest-owned artifact integrity passed."],
        limitations: ["The provider implementation is outside generated-artifact integrity."]
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
        verifiedGuarantees: ["The provider boundary was type-compatible."],
        limitations: ["Real-provider semantics were not exercised."]
      },
      {
        level: "real_provider_semantics",
        status: "not_run",
        verifiedGuarantees: [],
        limitations: ["No real-provider conformance run occurred."]
      }
    ],
    extraFiles: ["provider/simulated.ts"],
    limitations: [{
      code: "simulated_provider_only",
      level: "real_provider_semantics",
      message: "Real-provider semantics were not run.",
      nextAction: "Run provider-specific test-mode conformance."
    }],
    nextActions: ["Run provider-specific test-mode conformance."]
  };
}

export function iteration5Policy(): VerificationPolicy {
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
      receiptLimitations: "allow_declared"
    }
  };
}

export function iteration5AdapterReceipt(): AdapterConformanceReceipt {
  const names = [
    "success",
    "confirmed_failure",
    "timeout_after_success",
    "duplicate_invocation",
    "reconciliation_unavailable",
    "ambiguous_matches"
  ] as const;
  return {
    schemaVersion: "writeguard.adapter-conformance/v1",
    kind: "writeguard_adapter_conformance_receipt",
    provider: {
      id: "simulated-refund-adapter",
      version: "1.0.0",
      environment: "simulated"
    },
    overallResult: "passed",
    scenarios: names.map((scenario) => ({
      scenario,
      status: "passed",
      summary: "The adapter satisfied the public conformance scenario."
    })),
    verifiedGuarantees: names.map(
      (scenario) => `Scenario ${scenario} passed in simulated.`
    ),
    limitations: [
      "Conformance evidence applies only to the declared provider environment.",
      "Passing scenarios do not certify production behavior or undeclared provider guarantees."
    ]
  };
}

export function iteration5EvaluationReport(): LocalEvaluationReport {
  const verification = iteration5VerificationReceipt();
  return {
    schemaVersion: "writeguard.local-evaluation/v1",
    kind: "writeguard_local_evaluation_report",
    tool: {
      name: "refund_order",
      consequence: "simulated_refund"
    },
    analysis: {
      model: "gpt-5.6",
      source: "recorded_fixture",
      liveCall: false,
      status: "recommendation_only",
      artifactDigest: digest,
      evaluationEvidence: "sanitized_gpt-5.6_gate_9_of_9",
      exactLivePayloadRetained: false
    },
    developerApproval: {
      state: "approved",
      approvalWasInferred: false,
      reviewDigest: digest,
      reviewer: "evaluation-maintainer"
    },
    generation: {
      manifestDigest: digest,
      files: ["src/guarded-tool.ts", "test/failure.test.ts"]
    },
    effects: {
      unsafeExternalEffects: 2,
      guardedExternalEffects: 1
    },
    provider: {
      id: "simulated-refund-adapter",
      environment: "simulated"
    },
    verification: {
      static: verification,
      generatedTests: verification
    },
    policy: evaluateVerificationPolicy({
      policy: iteration5Policy(),
      receipt: verification
    }),
    adapterConformance: iteration5AdapterReceipt(),
    cleanConsumer: {
      packedPublicPackages: true,
      workspaceAliases: false,
      privateImports: false,
      postInstallNetworkCalls: 0,
      postgresqlRequired: false
    },
    networkCalls: {
      openAI: 0,
      stripe: 0,
      otherProviders: 0
    },
    limitations: [
      "The analysis is a deterministic recorded fixture; this command does not call GPT-5.6.",
      "The provider is simulated; real-provider semantics were not tested."
    ],
    nextIntegrationStep: "Implement and test a reviewed real-provider boundary."
  };
}
