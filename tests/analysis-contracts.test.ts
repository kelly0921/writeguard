import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { WRITEGUARD_VERSION } from "@closure/writeguard";
import {
  AnalysisContractValidationError,
  analysisContractVersion,
  createPendingDeveloperReview,
  digestAnalysisArtifact,
  parseDeveloperReview,
  parseRiskAnalysisResult,
  serializeAnalysisArtifact
} from "@closure/writeguard/analysis";
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };
import { normalizeMcpToolDefinition } from "@closure/writeguard/analysis";
import { createFixtureRiskAnalysis } from "./analysis-fixtures.js";

describe("versioned tool-analysis contracts", () => {
  it("keeps the exported SDK version aligned with the package manifest", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../packages/writeguard/package.json", import.meta.url), "utf8")
    ) as { version: string };
    expect(WRITEGUARD_VERSION).toBe(manifest.version);
  });

  it("validates structured recommendations without turning them into approved policy", () => {
    const normalized = normalizeMcpToolDefinition(refundTool);
    const analysis = parseRiskAnalysisResult(createFixtureRiskAnalysis(normalized));
    expect(analysis.schemaVersion).toBe(analysisContractVersion);
    expect(analysis.status).toBe("recommendation_only");
    expect(analysis.proposedGuardConfigurations[0]).toMatchObject({
      kind: "proposed_guard_configuration",
      reviewState: "requires_developer_approval",
      mode: "shadow"
    });
    const review = createPendingDeveloperReview(analysis);
    expect(review).toMatchObject({ decision: "pending", approvedProposalIds: [] });
  });

  it("rejects unsupported contract versions with an actionable error", () => {
    const analysis = createFixtureRiskAnalysis(normalizeMcpToolDefinition(refundTool));
    expect(() => parseRiskAnalysisResult({ ...analysis, schemaVersion: "writeguard.analysis/v2" }))
      .toThrow(/unsupported schema version writeguard\.analysis\/v2/);
  });

  it("requires explicit developer identity and proposal selection for approval", () => {
    const analysis = createFixtureRiskAnalysis(normalizeMcpToolDefinition(refundTool));
    const pending = createPendingDeveloperReview(analysis);
    expect(() => parseDeveloperReview({
      ...pending,
      decision: "approved",
      approvedProposalIds: []
    })).toThrow(AnalysisContractValidationError);
    expect(parseDeveloperReview({
      ...pending,
      decision: "approved",
      approvedProposalIds: ["proposal.shadow-first"],
      reviewer: "developer",
      reviewedAt: "2026-07-16T20:00:00.000Z"
    }).decision).toBe("approved");
  });

  it("serializes and digests equivalent artifacts deterministically", () => {
    expect(serializeAnalysisArtifact({ b: 2, a: { d: 4, c: 3 } })).toBe(
      serializeAnalysisArtifact({ a: { c: 3, d: 4 }, b: 2 })
    );
    expect(digestAnalysisArtifact({ b: 2, a: 1 })).toBe(digestAnalysisArtifact({ a: 1, b: 2 }));
  });
});
