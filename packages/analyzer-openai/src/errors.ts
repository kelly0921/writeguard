export const openAIAnalyzerErrorCodes = [
  "missing_api_key",
  "authentication_failed",
  "model_access_denied",
  "rate_limited",
  "timeout",
  "network_failure",
  "service_failure",
  "refusal",
  "incomplete_output",
  "invalid_structured_output",
  "schema_validation_failed",
  "provenance_mismatch",
  "unsupported_contract_version",
  "model_identity_mismatch",
  "unsupported_capability",
  "invalid_configuration",
  "input_too_large"
] as const;

export type OpenAIAnalyzerErrorCode = typeof openAIAnalyzerErrorCodes[number];

export class OpenAIAnalyzerError extends Error {
  constructor(
    readonly code: OpenAIAnalyzerErrorCode,
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OpenAIAnalyzerError";
  }
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object" ? error as Record<string, unknown> : {};
}

export function classifyOpenAIError(error: unknown): OpenAIAnalyzerError {
  if (error instanceof OpenAIAnalyzerError) return error;
  const value = errorRecord(error);
  const status = typeof value.status === "number" ? value.status : undefined;
  const name = typeof value.name === "string" ? value.name : "";
  const code = typeof value.code === "string" ? value.code : "";
  if (status === 401) {
    return new OpenAIAnalyzerError(
      "authentication_failed",
      "OpenAI authentication failed. Verify OPENAI_API_KEY is current and scoped for this project."
    );
  }
  if (status === 403 || status === 404) {
    return new OpenAIAnalyzerError(
      "model_access_denied",
      "The configured OpenAI project cannot access gpt-5.6. Request model access or use a project that has it; WriteGuard will not fall back to another model."
    );
  }
  if (status === 429) {
    return new OpenAIAnalyzerError(
      "rate_limited",
      "OpenAI rate-limited the analysis request. Retry after the provider delay or reduce evaluation concurrency."
    );
  }
  if (name === "APIConnectionTimeoutError" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return new OpenAIAnalyzerError(
      "timeout",
      "The GPT-5.6 analysis request timed out. Retry once the network is stable or increase the bounded timeout."
    );
  }
  if (name === "APIConnectionError" || ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return new OpenAIAnalyzerError(
      "network_failure",
      "The GPT-5.6 analysis request could not reach OpenAI. Check network and proxy settings, then retry."
    );
  }
  return new OpenAIAnalyzerError(
    "service_failure",
    status && status >= 500
      ? "OpenAI returned a server error during GPT-5.6 analysis. Retry later; no recommendation was accepted."
      : "GPT-5.6 analysis failed before a validated recommendation was produced."
  );
}
