import { describe, expect, it } from "vitest";
import {
  AnalyzerContractError,
  AnalysisContractValidationError,
  normalizeMcpToolDefinition,
  runToolRiskAnalyzer,
  type NormalizedToolDefinition,
  type RiskAnalysisResult,
  type ToolRiskAnalyzer
} from "@closure/writeguard/analysis";
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };
import { createFixtureRiskAnalysis, fixtureAnalyzerDescriptor } from "./analysis-fixtures.js";

class FixtureContractAnalyzer implements ToolRiskAnalyzer {
  readonly descriptor = fixtureAnalyzerDescriptor;
  received: NormalizedToolDefinition | null = null;

  async analyze(tool: NormalizedToolDefinition): Promise<RiskAnalysisResult> {
    this.received = tool;
    return createFixtureRiskAnalysis(tool);
  }
}

describe("injectable analyzer boundary", () => {
  it("accepts only normalized input and validates the structured result", async () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const analyzer = new FixtureContractAnalyzer();
    const result = await runToolRiskAnalyzer(analyzer, tool);
    expect(analyzer.received).toEqual(tool);
    expect(result.status).toBe("recommendation_only");
  });

  it("rejects result provenance that does not match the source tool", async () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const analyzer: ToolRiskAnalyzer = {
      descriptor: fixtureAnalyzerDescriptor,
      async analyze(input) {
        const result = createFixtureRiskAnalysis(input);
        const wrongProvenance = { ...result.provenance, sourceId: "0".repeat(64) };
        return {
          ...result,
          provenance: wrongProvenance,
          candidateOperations: result.candidateOperations.map((candidate) => ({
            ...candidate,
            provenance: wrongProvenance
          })),
          proposedGuardConfigurations: result.proposedGuardConfigurations.map((proposal) => ({
            ...proposal,
            provenance: wrongProvenance
          }))
        };
      }
    };
    await expect(runToolRiskAnalyzer(analyzer, tool)).rejects.toThrow(AnalyzerContractError);
  });

  it("rejects analyzer output that tries to embed approval state", async () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const analyzer: ToolRiskAnalyzer = {
      descriptor: fixtureAnalyzerDescriptor,
      async analyze(input) {
        return {
          ...createFixtureRiskAnalysis(input),
          developerApproval: { decision: "approved" }
        } as unknown as RiskAnalysisResult;
      }
    };
    await expect(runToolRiskAnalyzer(analyzer, tool)).rejects.toThrow(AnalysisContractValidationError);
  });
});
