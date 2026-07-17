import { describe, expect, it } from "vitest";
import {
  VERIFICATION_CONTRACT_VERSION,
  VERIFIER_ID,
  VERIFIER_VERSION,
  digestVerificationReceipt,
  parseVerificationReceipt,
  type VerificationReceipt
} from "@closure/writeguard-generator";

function validReceipt(): VerificationReceipt {
  return {
    schemaVersion: VERIFICATION_CONTRACT_VERSION,
    kind: "writeguard_verification_receipt",
    verifier: { id: VERIFIER_ID, version: VERIFIER_VERSION },
    mode: "safe_static",
    overallResult: "passed_with_limitations",
    inputs: {
      manifestDigest: "1".repeat(64),
      verificationBundleDigest: "2".repeat(64),
      sourceDigest: "3".repeat(64),
      analysisDigest: "4".repeat(64),
      developerReviewDigest: "5".repeat(64),
      providerFileDigest: null
    },
    outputs: {
      verifiedFileSetDigest: "6".repeat(64),
      compiledInputDigest: "7".repeat(64),
      generatedTestDigest: "8".repeat(64)
    },
    checks: [{
      id: "artifact.manifest",
      level: "artifact_integrity",
      status: "passed",
      summary: "The manifest passed.",
      diagnostics: []
    }],
    levels: [
      { level: "artifact_integrity", status: "passed", verifiedGuarantees: ["Digests matched."], limitations: [] },
      { level: "compilation", status: "passed", verifiedGuarantees: ["Types matched."], limitations: ["Not runtime proof."] },
      {
        level: "simulated_failure_behavior",
        status: "not_run",
        verifiedGuarantees: [],
        limitations: ["Explicit opt-in was not supplied."]
      },
      {
        level: "provider_integration_completeness",
        status: "passed_with_limitations",
        verifiedGuarantees: ["Hooks were identified."],
        limitations: ["Provider semantics remain unknown."]
      },
      {
        level: "real_provider_semantics",
        status: "not_run",
        verifiedGuarantees: [],
        limitations: ["No real provider ran."]
      }
    ],
    extraFiles: [],
    limitations: [{
      code: "digests_are_not_authenticity",
      level: "artifact_integrity",
      message: "Digests prove integrity, not authenticity.",
      nextAction: "Use a trusted source."
    }],
    nextActions: ["Implement provider conformance checks."]
  };
}

describe("verification receipt contracts", () => {
  it("accepts a valid deterministic receipt with explicit limitations", () => {
    expect(parseVerificationReceipt(validReceipt())).toEqual(validReceipt());
  });

  it("rejects an invalid receipt and an unsupported contract version", () => {
    expect(() => parseVerificationReceipt({ ...validReceipt(), checks: [] })).toThrow();
    expect(() => parseVerificationReceipt({
      ...validReceipt(),
      schemaVersion: "writeguard.verification/v999"
    })).toThrow();
  });

  it("produces the same digest for semantically identical key order", () => {
    const receipt = validReceipt();
    const reordered = JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>;
    const reverse = Object.fromEntries(Object.entries(reordered).reverse());
    expect(digestVerificationReceipt(reverse)).toBe(digestVerificationReceipt(receipt));
  });

  it("requires limitations and represents real-provider semantics as not run", () => {
    expect(validReceipt().limitations).toContainEqual(expect.objectContaining({
      code: "digests_are_not_authenticity"
    }));
    expect(validReceipt().levels.find((level) => level.level === "real_provider_semantics")).toMatchObject({
      status: "not_run",
      verifiedGuarantees: []
    });
  });
});
