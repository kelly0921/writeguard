import { describe, expect, it } from "vitest";
import {
  digestLocalEvaluationReport,
  parseLocalEvaluationReport,
  renderLocalEvaluationSummary
} from "@closure/writeguard-generator";
import { iteration5EvaluationReport } from "./iteration5-fixtures.js";

describe("local evaluation report", () => {
  it("runtime-validates and deterministically renders a receipt-derived summary", () => {
    const report = iteration5EvaluationReport();
    expect(parseLocalEvaluationReport(report)).toEqual(report);
    expect(renderLocalEvaluationSummary(report)).toBe(renderLocalEvaluationSummary(report));
    expect(digestLocalEvaluationReport(report)).toBe(digestLocalEvaluationReport(report));
  });

  it("labels recorded model evidence, explicit approval, simulation, and real-provider status", () => {
    const summary = renderLocalEvaluationSummary(iteration5EvaluationReport());
    expect(summary).toContain("Analysis: gpt-5.6, recorded fixture, recommendation-only");
    expect(summary).toContain("Live model call during this evaluation: no");
    expect(summary).toContain("Developer approval: approved; inferred: no");
    expect(summary).toContain("Provider: simulated-refund-adapter (simulated)");
    expect(summary).toContain("Real-provider semantics: not_run");
  });

  it("derives effect counts and verification status from the report rather than prose", () => {
    const report = iteration5EvaluationReport();
    report.effects.unsafeExternalEffects = 3;
    report.verification.generatedTests.checks.find(
      (check) => check.id === "tests.generated_failure_behavior"
    )!.status = "failed";
    const summary = renderLocalEvaluationSummary(report);
    expect(summary).toContain("Unsafe simulated external effects: 3");
    expect(summary).toContain("Generated failure tests: failed");
  });

  it("rejects contradictory live-evidence claims", () => {
    const report = iteration5EvaluationReport();
    report.analysis.exactLivePayloadRetained = true;
    expect(() => parseLocalEvaluationReport(report)).toThrow();
  });

  it("rejects credential-shaped summaries and absolute user paths", () => {
    const secret = iteration5EvaluationReport();
    secret.limitations = [`Never emit ${"sk_" + "test_" + "abcdefghijklmnop"}.`];
    expect(() => renderLocalEvaluationSummary(secret)).toThrow(
      "credential-shaped value"
    );

    const path = iteration5EvaluationReport();
    path.nextIntegrationStep = "Inspect C:\\Users\\developer\\private\\result.json.";
    expect(() => renderLocalEvaluationSummary(path)).toThrow("absolute user path");
  });
});
