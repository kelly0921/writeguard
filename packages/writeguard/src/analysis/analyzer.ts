import {
  analyzerDescriptorSchema,
  parseNormalizedToolDefinition,
  parseRiskAnalysisResult,
  type AnalyzerDescriptor,
  type NormalizedToolDefinition,
  type RiskAnalysisResult
} from "./contracts.js";

export interface ToolRiskAnalyzer {
  readonly descriptor: AnalyzerDescriptor;
  analyze(tool: NormalizedToolDefinition): Promise<RiskAnalysisResult>;
}

export class AnalyzerContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzerContractError";
  }
}

export async function runToolRiskAnalyzer(
  analyzer: ToolRiskAnalyzer,
  tool: NormalizedToolDefinition
): Promise<RiskAnalysisResult> {
  const descriptor = analyzerDescriptorSchema.parse(analyzer.descriptor);
  const validatedTool = parseNormalizedToolDefinition(tool);
  const result = parseRiskAnalysisResult(await analyzer.analyze(validatedTool));
  if (result.analyzer.id !== descriptor.id || result.analyzer.version !== descriptor.version) {
    throw new AnalyzerContractError(
      "Analyzer result descriptor does not match the configured analyzer descriptor"
    );
  }
  if (result.provenance.sourceId !== validatedTool.provenance.sourceId ||
      result.provenance.toolName !== validatedTool.provenance.toolName) {
    throw new AnalyzerContractError(
      "Analyzer result provenance does not match the normalized tool supplied for analysis"
    );
  }
  return result;
}
