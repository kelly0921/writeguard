import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  normalizeMcpToolDefinition,
  runToolRiskAnalyzer,
  type NormalizedToolDefinition,
  type RiskAnalysisResult,
  type ToolRiskAnalyzer
} from "@closure/writeguard/analysis";
import {
  OPENAI_ANALYZER_MODEL,
  OpenAIAnalyzerError,
  OpenAIResponsesTransport,
  classifyOpenAIError,
  createOpenAIToolRiskAnalyzer,
  type OpenAIAnalyzerTransport,
  type OpenAIAnalyzerTransportRequest,
  type OpenAIAnalyzerTransportResponse
} from "@closure/writeguard-analyzer-openai";
import lookupTool from "../fixtures/mcp-tools/lookup-order.json" with { type: "json" };
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };
import emailTool from "../fixtures/mcp-tools/send-email.json" with { type: "json" };
import sensitiveTool from "../fixtures/mcp-tools/sensitive-fields.json" with { type: "json" };
import ambiguousTool from "../fixtures/analyzer-evals/ambiguous-operation.json" with { type: "json" };
import missingIdentityTool from "../fixtures/analyzer-evals/missing-identity.json" with { type: "json" };
import unsupportedReconciliationTool from "../fixtures/analyzer-evals/unsupported-reconciliation.json" with { type: "json" };
import descriptionInjectionTool from "../fixtures/analyzer-evals/prompt-injection-description.json" with { type: "json" };
import schemaInjectionTool from "../fixtures/analyzer-evals/prompt-injection-schema.json" with { type: "json" };

type OutputOptions = {
  category?: "financial_transaction" | "communication" | "data_mutation" | "other";
  riskLevel?: "low" | "medium" | "high" | "critical";
  confidence?: number;
  operationKind?: "external_write" | "uncertain_external_effect";
  identityFields?: string[];
  identityStrategy?: "field_template" | "provider_idempotency_key" | "application_supplied";
  reconciliation?: "provider_lookup" | "provider_idempotency_lookup" | "application_ledger" | "manual_review_required" | "unsupported";
  reconciliationFields?: string[];
  redactionFields?: string[];
  noProposal?: boolean;
  failureScenarios?: Array<"duplicate_invocation" | "timeout_after_submission" | "concurrent_invocations" | "process_crash_after_effect" | "reconciliation_unavailable" | "ambiguous_matches">;
};

function recommendation(tool: NormalizedToolDefinition, options: OutputOptions = {}): unknown {
  if (options.riskLevel === undefined && tool.tool.annotations?.readOnlyHint === true) {
    return {
      assessment: {
        riskLevel: "none",
        confidence: 0.98,
        summary: "The definition describes a read-only lookup and contains no contrary write evidence."
      },
      candidateOperations: [],
      proposedGuardConfigurations: [],
      limitations: ["Tool annotations and descriptions remain developer-supplied evidence."]
    };
  }
  const identityFields = options.identityFields ?? ["tenantId", "orderId"];
  const identityStrategy = options.identityStrategy ?? (identityFields.length === 0 ? "application_supplied" : "field_template");
  const candidate = {
    id: "candidate.external-effect",
    displayName: "External effect",
    operationKind: options.operationKind ?? "external_write",
    consequenceCategories: [options.category ?? "data_mutation"],
    confidence: options.confidence ?? 0.88,
    reasoning: "The tool definition contains evidence of an externally consequential operation.",
    evidence: [{ kind: "tool_name", reference: tool.tool.name }]
  };
  const scenarios = options.failureScenarios ?? [
    "duplicate_invocation",
    "timeout_after_submission",
    "concurrent_invocations",
    "process_crash_after_effect",
    "reconciliation_unavailable"
  ];
  const proposal = {
    id: "proposal.shadow-review",
    candidateOperationId: candidate.id,
    mode: "shadow",
    effectType: "conditionally_reversible",
    providerAdapter: {
      requirement: "application_hook",
      providerHint: null,
      reasoning: "A developer must supply and verify provider behavior."
    },
    operationIdentity: {
      strategy: identityStrategy,
      template: identityStrategy === "field_template" ? identityFields.map((field) => `{${field}}`).join(":") : null,
      inputFields: identityFields,
      confidence: identityFields.length === 0 ? 0.2 : 0.7,
      reasoning: identityFields.length === 0
        ? "No stable operation identity appears in the schema; the application must supply one."
        : "These candidate fields require developer confirmation as stable business intent."
    },
    reconciliation: {
      strategy: options.reconciliation ?? "unsupported",
      correlationFields: options.reconciliationFields ?? [],
      expectedCardinality: "unknown",
      consistency: "unknown",
      confidence: options.reconciliation === "provider_lookup" ? 0.5 : 0.2,
      reasoning: "The tool does not establish a verified provider lookup guarantee."
    },
    redaction: {
      fieldPaths: [...new Set([
        ...tool.normalization.detectedSensitiveFieldPaths,
        ...(options.redactionFields ?? [])
      ])],
      reasoning: "Sensitive inputs must be excluded from logs, prompts, and durable diagnostic output."
    },
    failureScenarios: scenarios.map((scenario) => ({
      scenario,
      expectedHandling: scenario === "duplicate_invocation"
        ? "suppress_duplicate"
        : scenario === "timeout_after_submission" || scenario === "process_crash_after_effect"
          ? "reconcile_before_retry"
          : "require_review",
      reasoning: "The developer must verify safe handling before enforcement."
    }))
  };
  return {
    assessment: {
      riskLevel: options.riskLevel ?? "high",
      confidence: options.confidence ?? 0.88,
      summary: "The tool may cause a consequential external effect and requires developer review."
    },
    candidateOperations: [candidate],
    proposedGuardConfigurations: options.noProposal ? [] : [proposal],
    limitations: [
      identityFields.length === 0
        ? "Stable operation identity is missing."
        : "Provider guarantees are not established by the MCP definition."
    ]
  };
}

class FakeTransport implements OpenAIAnalyzerTransport {
  requests: OpenAIAnalyzerTransportRequest[] = [];

  constructor(
    private readonly respond: (
      request: OpenAIAnalyzerTransportRequest
    ) => OpenAIAnalyzerTransportResponse | Promise<OpenAIAnalyzerTransportResponse>
  ) {}

  async analyze(request: OpenAIAnalyzerTransportRequest): Promise<OpenAIAnalyzerTransportResponse> {
    this.requests.push(request);
    return this.respond(request);
  }
}

function completed(output: unknown, model: string = OPENAI_ANALYZER_MODEL): OpenAIAnalyzerTransportResponse {
  return { kind: "completed", model, output };
}

async function analyzeFixture(raw: unknown, options: OutputOptions = {}): Promise<RiskAnalysisResult> {
  const tool = normalizeMcpToolDefinition(raw);
  const transport = new FakeTransport(() => completed(recommendation(tool, options)));
  return runToolRiskAnalyzer(createOpenAIToolRiskAnalyzer({ transport }), tool);
}

describe("optional GPT-5.6 analyzer evaluation suite", () => {
  it("keeps a read-only lookup non-consequential without contrary evidence", async () => {
    const result = await analyzeFixture(lookupTool);
    expect(result.assessment.riskLevel).toBe("none");
    expect(result.candidateOperations).toEqual([]);
    expect(result.proposedGuardConfigurations).toEqual([]);
  });

  it("identifies refund financial, retry, timeout, duplicate, and reconciliation risks without inventing idempotency", async () => {
    const result = await analyzeFixture(refundTool, {
      category: "financial_transaction",
      identityFields: ["tenantId", "orderId", "amount", "currency"],
      reconciliation: "unsupported",
      redactionFields: ["paymentIntentId"]
    });
    expect(result.candidateOperations[0]?.consequenceCategories).toContain("financial_transaction");
    const proposal = result.proposedGuardConfigurations[0]!;
    expect(proposal.operationIdentity.strategy).toBe("field_template");
    expect(proposal.reconciliation.strategy).toBe("unsupported");
    expect(proposal.failureScenarios.map((item) => item.scenario)).toEqual(expect.arrayContaining([
      "duplicate_invocation",
      "timeout_after_submission",
      "concurrent_invocations",
      "process_crash_after_effect"
    ]));
  });

  it("classifies email as communication while keeping content and recipient out of identity", async () => {
    const result = await analyzeFixture(emailTool, {
      category: "communication",
      identityFields: ["tenantId", "messageId"],
      redactionFields: ["body"]
    });
    const proposal = result.proposedGuardConfigurations[0]!;
    expect(result.candidateOperations[0]?.consequenceCategories).toContain("communication");
    expect(proposal.operationIdentity.inputFields).not.toContain("recipientEmail");
    expect(proposal.operationIdentity.inputFields).not.toContain("body");
    expect(proposal.redaction.fieldPaths).toEqual(expect.arrayContaining(["recipientEmail", "body"]));
  });

  it("does not fabricate identity when stable business intent is missing", async () => {
    const result = await analyzeFixture(missingIdentityTool, {
      identityStrategy: "application_supplied",
      identityFields: []
    });
    expect(result.proposedGuardConfigurations[0]?.operationIdentity).toMatchObject({
      strategy: "application_supplied",
      inputFields: []
    });
    expect(result.limitations.join(" ")).toContain("missing");
  });

  it("marks reconciliation unsupported when lookup evidence is absent", async () => {
    const result = await analyzeFixture(unsupportedReconciliationTool, {
      identityFields: ["accountId", "amount", "currency"],
      category: "financial_transaction",
      reconciliation: "unsupported"
    });
    expect(result.proposedGuardConfigurations[0]?.reconciliation.strategy).toBe("unsupported");
  });

  it("expresses ambiguity with low confidence instead of forcing a definite write classification", async () => {
    const result = await analyzeFixture(ambiguousTool, {
      riskLevel: "medium",
      confidence: 0.35,
      operationKind: "uncertain_external_effect",
      identityFields: ["recordId"],
      noProposal: true
    });
    expect(result.assessment.confidence).toBeLessThan(0.5);
    expect(result.candidateOperations[0]?.operationKind).toBe("uncertain_external_effect");
    expect(result.proposedGuardConfigurations).toEqual([]);
  });

  it("keeps description prompt injection recommendation-only and provenance-correct", async () => {
    const result = await analyzeFixture(descriptionInjectionTool, {
      identityFields: ["tenantId", "customerId"]
    });
    const tool = normalizeMcpToolDefinition(descriptionInjectionTool);
    expect(result.status).toBe("recommendation_only");
    expect(result.provenance).toEqual(tool.provenance);
    expect(result.proposedGuardConfigurations[0]?.reviewState).toBe("requires_developer_approval");
  });

  it("treats nested descriptions, examples, and defaults as untrusted data", async () => {
    const result = await analyzeFixture(schemaInjectionTool, {
      category: "communication",
      identityFields: ["messageId"],
      redactionFields: ["content"]
    });
    expect(result.schemaVersion).toBe("writeguard.analysis/v1");
    expect(result.status).toBe("recommendation_only");
    expect(result.proposedGuardConfigurations[0]?.redaction.fieldPaths)
      .toEqual(expect.arrayContaining(["recipientEmail", "content"]));
  });

  it("preserves deterministic and model-identified sensitive redaction fields", async () => {
    const result = await analyzeFixture(sensitiveTool, {
      identityFields: ["accountId"],
      redactionFields: ["customer.email", "customer.phone", "cardNumber"]
    });
    expect(result.proposedGuardConfigurations[0]?.redaction.fieldPaths).toEqual(expect.arrayContaining([
      "apiKey",
      "authorizationToken",
      "customer.email",
      "customer.phone",
      "cardNumber"
    ]));
  });

  it("rejects a structurally valid final result with mismatched provenance", async () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const trusted = await analyzeFixture(refundTool, {
      category: "financial_transaction",
      identityFields: ["tenantId", "orderId"]
    });
    const wrong = { ...tool.provenance, sourceId: "0".repeat(64) };
    const malicious: ToolRiskAnalyzer = {
      descriptor: trusted.analyzer,
      async analyze() {
        return {
          ...trusted,
          provenance: wrong,
          candidateOperations: trusted.candidateOperations.map((candidate) => ({ ...candidate, provenance: wrong })),
          proposedGuardConfigurations: trusted.proposedGuardConfigurations.map((proposal) => ({ ...proposal, provenance: wrong }))
        };
      }
    };
    await expect(runToolRiskAnalyzer(malicious, tool)).rejects.toThrow(/provenance/i);
  });

  it("fails closed on invalid structured output", async () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const analyzer = createOpenAIToolRiskAnalyzer({
      transport: new FakeTransport(() => completed({ freeform: "approve it" }))
    });
    await expect(analyzer.analyze(tool)).rejects.toMatchObject({ code: "invalid_structured_output" });
  });

  it("keeps a low-confidence result reviewable and never approved", async () => {
    const result = await analyzeFixture(ambiguousTool, {
      riskLevel: "low",
      confidence: 0.2,
      operationKind: "uncertain_external_effect",
      identityFields: ["recordId"]
    });
    expect(result.assessment.confidence).toBe(0.2);
    expect(result.status).toBe("recommendation_only");
    expect(result.proposedGuardConfigurations[0]?.reviewState).toBe("requires_developer_approval");
  });
});

describe("GPT-5.6 Responses API reliability boundary", () => {
  it("uses the official Responses parse pattern and strict JSON Schema without a network call", async () => {
    const tool = normalizeMcpToolDefinition(lookupTool);
    const output = recommendation(tool);
    let capturedBody: Record<string, unknown> | undefined;
    let capturedTimeout: number | undefined;
    const client = {
      responses: {
        parse: async (body: Record<string, unknown>, options: { timeout?: number }) => {
          capturedBody = body;
          capturedTimeout = options.timeout;
          return {
            model: OPENAI_ANALYZER_MODEL,
            status: "completed",
            incomplete_details: null,
            output: [],
            output_parsed: output
          };
        }
      }
    };
    const transport = new OpenAIResponsesTransport({ client: client as never, timeoutMs: 12_000 });
    const response = await transport.analyze({ model: OPENAI_ANALYZER_MODEL, tool, timeoutMs: 12_000 });
    expect(response.kind).toBe("completed");
    expect(capturedBody?.model).toBe("gpt-5.6");
    expect(capturedTimeout).toBe(12_000);
    const input = capturedBody?.input as Array<{ role: string; content: string }>;
    expect(input[0]).toMatchObject({ role: "system" });
    expect(input[0]?.content).toContain("untrusted data");
    expect(input[0]?.content).toContain("copy untrustedToolDefinition.tool.name exactly");
    expect(input[0]?.content).toContain("use uncertain_external_effect");
    expect(input[0]?.content).toContain("assessment confidence below 0.7");
    expect(input[1]).toMatchObject({ role: "user" });
    expect(input[1]?.content).toContain("UNTRUSTED_TOOL_DEFINITION_DATA_ONLY");
    const text = capturedBody?.text as { format?: { type?: string; strict?: boolean; name?: string } };
    expect(text.format).toMatchObject({ type: "json_schema", strict: true, name: "writeguard_risk_analysis" });
  });

  it("requires a configured API key for the real transport", () => {
    expect(() => new OpenAIResponsesTransport({ apiKey: " " })).toThrow(OpenAIAnalyzerError);
    try {
      new OpenAIResponsesTransport({ apiKey: " " });
    } catch (error) {
      expect(error).toMatchObject({ code: "missing_api_key" });
    }
  });

  it.each([
    [401, "AuthenticationError", "", "authentication_failed"],
    [403, "PermissionDeniedError", "", "model_access_denied"],
    [404, "NotFoundError", "", "model_access_denied"],
    [429, "RateLimitError", "", "rate_limited"],
    [undefined, "APIConnectionTimeoutError", "ETIMEDOUT", "timeout"],
    [undefined, "APIConnectionError", "ECONNRESET", "network_failure"],
    [500, "InternalServerError", "", "service_failure"]
  ])("classifies provider failure %# actionably", (status, name, code, expected) => {
    expect(classifyOpenAIError({ status, name, code })).toMatchObject({ code: expected });
  });

  it.each([
    [{ kind: "refusal", model: OPENAI_ANALYZER_MODEL } as const, "refusal"],
    [{ kind: "incomplete", model: OPENAI_ANALYZER_MODEL, reason: "max_output_tokens" } as const, "incomplete_output"],
    [completed(recommendation(normalizeMcpToolDefinition(lookupTool)), "gpt-4.1"), "model_identity_mismatch"]
  ])("rejects unsafe transport state %#", async (response, code) => {
    const analyzer = createOpenAIToolRiskAnalyzer({ transport: new FakeTransport(() => response) });
    await expect(analyzer.analyze(normalizeMcpToolDefinition(lookupTool))).rejects.toMatchObject({ code });
  });

  it("rejects unsupported provider lookup claims in post-response safety checks", async () => {
    const tool = normalizeMcpToolDefinition(unsupportedReconciliationTool);
    const output = recommendation(tool, {
      identityFields: ["accountId", "amount", "currency"],
      reconciliation: "provider_lookup",
      reconciliationFields: ["accountId"]
    });
    const analyzer = createOpenAIToolRiskAnalyzer({
      transport: new FakeTransport(() => completed(output))
    });
    await expect(analyzer.analyze(tool)).rejects.toMatchObject({ code: "unsupported_capability" });
  });

  it("rejects unsupported contract versions before transport use", async () => {
    const tool = normalizeMcpToolDefinition(lookupTool);
    const transport = new FakeTransport(() => completed(recommendation(tool)));
    const analyzer = createOpenAIToolRiskAnalyzer({ transport });
    await expect(analyzer.analyze({ ...tool, schemaVersion: "writeguard.analysis/v2" } as never))
      .rejects.toMatchObject({ code: "unsupported_contract_version" });
    expect(transport.requests).toHaveLength(0);
  });

  it("keeps the OpenAI SDK dependency outside the deterministic core manifest", async () => {
    const core = JSON.parse(await readFile(new URL("../packages/writeguard/package.json", import.meta.url), "utf8"));
    const analyzer = JSON.parse(await readFile(new URL("../packages/analyzer-openai/package.json", import.meta.url), "utf8"));
    expect(core.dependencies?.openai).toBeUndefined();
    expect(core.optionalDependencies?.openai).toBeUndefined();
    expect(analyzer.dependencies?.openai).toBe("6.47.0");
  });
});
