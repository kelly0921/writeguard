import {
  normalizeMcpToolDefinition,
  runToolRiskAnalyzer
} from "@closure/writeguard/analysis";
import {
  OPENAI_ANALYZER_MODEL,
  createOpenAIToolRiskAnalyzer,
  type OpenAIAnalyzerTransport
} from "@closure/writeguard-analyzer-openai";

const tool = normalizeMcpToolDefinition({
  name: "lookup_order",
  inputSchema: { type: "object", properties: { orderId: { type: "string" } } },
  annotations: { readOnlyHint: true }
});

const transport: OpenAIAnalyzerTransport = {
  async analyze(request) {
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
};

void runToolRiskAnalyzer(createOpenAIToolRiskAnalyzer({ transport }), tool);
