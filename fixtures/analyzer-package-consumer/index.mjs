import assert from "node:assert/strict";
import {
  normalizeMcpToolDefinition,
  runToolRiskAnalyzer
} from "@closure/writeguard/analysis";
import {
  OPENAI_ANALYZER_MODEL,
  createOpenAIToolRiskAnalyzer
} from "@closure/writeguard-analyzer-openai";

const tool = normalizeMcpToolDefinition({
  name: "lookup_order",
  description: "Read an order without changing state.",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string" } },
    required: ["orderId"]
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
});

const analyzer = createOpenAIToolRiskAnalyzer({
  transport: {
    async analyze(request) {
      assert.equal(request.model, "gpt-5.6");
      assert.equal(request.tool.provenance.sourceId, tool.provenance.sourceId);
      return {
        kind: "completed",
        model: OPENAI_ANALYZER_MODEL,
        output: {
          assessment: { riskLevel: "none", confidence: 0.99, summary: "Read-only lookup." },
          candidateOperations: [],
          proposedGuardConfigurations: [],
          limitations: ["External consumer fake transport; no model call was made."]
        }
      };
    }
  }
});

const result = await runToolRiskAnalyzer(analyzer, tool);
assert.equal(result.analyzer.id, "openai.gpt-5.6");
assert.equal(result.status, "recommendation_only");
assert.equal(result.provenance.sourceId, tool.provenance.sourceId);
assert.equal(result.assessment.riskLevel, "none");

console.log(JSON.stringify({
  coreImport: "@closure/writeguard/analysis",
  analyzerImport: "@closure/writeguard-analyzer-openai",
  model: OPENAI_ANALYZER_MODEL,
  fakeTransport: true,
  status: result.status
}));
