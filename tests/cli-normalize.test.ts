import { describe, expect, it } from "vitest";
import { runWriteGuardCli, type WriteGuardCliIo } from "../packages/writeguard/src/cli-program.js";
import type { ToolRiskAnalyzer } from "@closure/writeguard/analysis";
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };
import { createFixtureRiskAnalysis } from "./analysis-fixtures.js";

function capture(stdin: string) {
  let stdout = "";
  let stderr = "";
  const io: WriteGuardCliIo = {
    stdout: (message) => { stdout += message; },
    stderr: (message) => { stderr += message; },
    readStdin: async () => stdin
  };
  return { io, output: () => ({ stdout, stderr }) };
}

describe("WriteGuard analysis CLI", () => {
  it("emits deterministic machine-readable normalized JSON to stdout", async () => {
    const first = capture(JSON.stringify(refundTool));
    const second = capture(JSON.stringify(refundTool));
    expect(await runWriteGuardCli(["normalize-mcp", "-"], first.io)).toBe(0);
    expect(await runWriteGuardCli(["normalize-mcp", "-"], second.io)).toBe(0);
    expect(first.output().stderr).toBe("");
    expect(first.output().stdout).toBe(second.output().stdout);
    expect(JSON.parse(first.output().stdout)).toMatchObject({
      kind: "normalized_tool_definition",
      tool: { name: "refund_order" }
    });
  });

  it("uses stderr and a validation exit code for invalid input", async () => {
    const captured = capture("not-json");
    expect(await runWriteGuardCli(["normalize-mcp", "-"], captured.io)).toBe(3);
    expect(captured.output().stdout).toBe("");
    expect(captured.output().stderr).toContain("input is not valid JSON");
  });

  it("runs analyze through an injected analyzer and preserves JSON-only stdout", async () => {
    const captured = capture(JSON.stringify(refundTool));
    const analyzer: ToolRiskAnalyzer = {
      descriptor: { id: "fixture.cli", version: "1.0.0" },
      async analyze(tool) {
        return createFixtureRiskAnalysis(tool, { analyzer: this.descriptor });
      }
    };
    expect(await runWriteGuardCli(["analyze", "-", "--pretty"], captured.io, {
      loadAnalyzer: async () => analyzer
    })).toBe(0);
    expect(captured.output().stderr).toBe("");
    expect(JSON.parse(captured.output().stdout)).toMatchObject({
      kind: "risk_analysis_result",
      status: "recommendation_only",
      analyzer: { id: "fixture.cli" }
    });
  });

  it("exits nonzero without emitting partial JSON when analysis fails", async () => {
    const captured = capture(JSON.stringify(refundTool));
    expect(await runWriteGuardCli(["analyze", "-"], captured.io, {
      loadAnalyzer: async () => { throw new Error("OPENAI_API_KEY is not configured"); }
    })).toBe(4);
    expect(captured.output().stdout).toBe("");
    expect(captured.output().stderr).toContain("OPENAI_API_KEY is not configured");
  });
});
