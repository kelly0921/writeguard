# Tool Analysis Product Contract

## Customer journey

The target journey is one protected action in under ten minutes:

1. A developer supplies an MCP tool definition.
2. WriteGuard validates and deterministically normalizes the source.
3. An explicitly configured analyzer evaluates possible consequential external effects.
4. The analyzer emits structured recommendations with provenance, confidence, reasoning, and limitations.
5. The developer reviews, edits, and explicitly approves selected proposals.
6. A later generator produces a reviewable wrapper and failure tests from the approved artifact.
7. WriteGuard verifies deterministic behavior and the runtime returns ordinary execution receipts.

Iteration 2 implements steps 2–4 and the explicit pending-review boundary for step 5. It does not approve a proposal or claim steps 6–7 as a complete product workflow.

## Trust and control boundary

```text
MCP definition
  -> deterministic normalizer
  -> versioned normalized source
  -> optional GPT-5.6 analyzer (design-time only)
  -> recommendation-only analysis
  -> developer review and approval
  -> generator/verifier (future)
  -> deterministic WriteGuard runtime
  -> execution receipt
```

- GPT-5.6 analyzes and proposes. It does not approve, execute, reconcile, verify, or decide runtime state.
- The developer reviews and approves. Approval is a separate artifact bound to the analysis digest.
- WriteGuard enforces deterministically. The execution SDK imports no OpenAI client and requires no model or API key.
- An analyzer cannot smuggle approval into its response: the analysis schema is strict, has `status: recommendation_only`, and guard proposals have `reviewState: requires_developer_approval`.

## Initial input

The supported input is one MCP-style tool definition containing `name`, optional `description`, object-shaped `inputSchema`, and relevant MCP annotations. Normalization is domain-neutral. Refund, email, account mutation, infrastructure, and read-only tools use the same code path. The normalizer does not classify risk and never calls a model or network service. `analyze` first performs this exact deterministic step, then passes only the validated `NormalizedToolDefinition` to the optional analyzer.

Future adapters may normalize OpenAPI operations, framework tool declarations, or other IDLs into the same `NormalizedToolDefinition`. OpenAPI ingestion is explicitly not implemented during Iteration 2.

## Public artifacts

All Build Week artifacts use `schemaVersion: writeguard.analysis/v1` and strict runtime validation.

- `NormalizedToolDefinition`: deterministic source data, full JSON-compatible input schema, annotations, provenance, and sensitive-field hints. `sourceId` is a canonical SHA-256 digest, not a framework call ID.
- `CandidateConsequentialOperation`: recommendation identifying a possible external-write operation, consequence categories, confidence, reasoning, and evidence references.
- `RiskAnalysisResult`: recommendation-only artifact with analyzer identity, provenance, assessment, candidates, guard proposals, and limitations.
- `ProposedGuardConfiguration`: proposed mode, effect type, adapter requirement, operation identity, reconciliation, redaction, and failure scenarios. It always requires approval.
- `DeveloperReview`: separate artifact bound to the analysis digest. Approval requires reviewer, timestamp, and selected proposal IDs.

## Provider adapters and reconciliation

Analysis may recommend an existing adapter, application hook, or new adapter. It may identify likely correlation fields, cardinality, and consistency expectations. It cannot invent provider semantics as fact.

Before enforcement, a developer must confirm stable business identity, provider idempotency, zero/one/many reconciliation behavior, consistency windows, verification, reversibility, and sensitive-field handling. The runtime continues to fail closed on unresolved external state.

## Shared CLI, UI, and hosted contracts

The programmatic API is the source of truth. CLI commands serialize the same public artifacts a future UI or hosted experience would consume. No CLI-only state or UI-specific analysis model is permitted.

Iteration 2 implements:

```text
writeguard normalize-mcp <tool-definition.json|->
writeguard analyze <tool-definition.json|->
```

Both commands emit machine-readable JSON by default and support `--pretty`; errors remain on stderr. `normalize-mcp` is no-network. `analyze` dynamically loads `@closure/writeguard-analyzer-openai`, requires `OPENAI_API_KEY`, always targets `gpt-5.6`, and exits 4 without partial stdout when analysis is missing, refused, incomplete, invalid, mismatched, or unsafe. `generate`, `verify`, an approval CLI, and a receipt `report` remain unimplemented. A future UI must use `@closure/writeguard/analysis` rather than a parallel contract.

## Versioning and compatibility

- `writeguard.analysis/v1` is independent of the npm package version.
- Breaking changes require a new contract version and explicit parser/migration path.
- Unknown versions fail with actionable errors and are never silently coerced.
- The 0.4.0 checkpoint added `./analysis` and a CLI bin without removing `.` or `./testing`; unreleased 0.5.0 adds the working dynamic `analyze` path.
- Generated artifacts must record the contract version and source/analysis digest.
- `@closure/writeguard-analyzer-openai@0.1.0` depends on these public contracts. The deterministic package does not depend on the optional implementation or OpenAI SDK.

## Security, privacy, and redaction

- Tool definitions are schemas, not runtime inputs; callers must not embed credentials or customer values in defaults/examples.
- The normalizer rejects common credential-shaped values in metadata/schema.
- Sensitive-field paths are deterministic review hints, not a complete data-classification system.
- Source content is never uploaded by `normalize-mcp`. `analyze` sends the complete normalized definition to OpenAI, including names, descriptions, schema metadata, examples, and defaults.
- Analyzer implementations receive only validated normalized tools and must return validated risk-analysis artifacts.
- Callers must remove real credentials, personal data, confidential text, and sensitive defaults/examples before analysis. Credential-shape rejection is not complete data-loss prevention.
- Analyzer errors and sanitized evaluation reports do not include raw prompts, responses, API keys, or full sensitive inputs.
- Prompts, logs, generated files, and future UI views must preserve WriteGuard's minimal-data and redaction guarantees.

## GPT-5.6 integration and trusted envelope

The optional package uses the official OpenAI JavaScript SDK's Responses API parse helper with strict JSON Schema structured output and the fixed model alias `gpt-5.6`. It does not silently substitute another model. The default timeout is 60 seconds. The SDK is configured for at most one retry for its transient retry categories; callers can use zero retries to minimize possible duplicate billing.

The model-facing schema contains only assessment, candidate-operation, guard-proposal, failure, redaction, reconciliation, reasoning, confidence, and limitation fields. It intentionally cannot emit:

- `schemaVersion` or result `kind`;
- input provenance or digest;
- analyzer identity;
- `recommendation_only` status;
- `requires_developer_approval` review state.

Trusted application code attaches those fields from the validated input and fixed analyzer descriptor, then validates the existing `RiskAnalysisResult`. `runToolRiskAnalyzer` independently verifies the final descriptor and provenance. Post-response checks reject unknown input-field references, omission of deterministically detected sensitive fields, unsupported provider idempotency, provider reconciliation without explicit lookup evidence, and claims that an adapter is already installed.

Refusal, incomplete output, invalid structured output, public-contract failure, provenance/model mismatch, unsupported contract versions, unsupported capabilities, authentication/access failure, rate limit, timeout, and network/service failures are errors—not low-confidence success. Error messages identify remediation without including keys or full tool content.

## Prompt-injection boundary

Tool names, descriptions, annotations, property names, property descriptions, defaults, examples, and every nested string are untrusted data. The request separates system instructions from a canonical JSON data envelope and explicitly prohibits following tool-contained instructions. Strict output, runtime validation, trusted envelope attachment, post-response checks, and adversarial fixtures provide layered defenses.

This does not make a complete prompt-injection immunity claim. Model classification and reasoning remain probabilistic. A developer must review each recommendation, and deterministic WriteGuard execution—not GPT-5.6—provides the runtime reliability guarantee.

## Explicit Build Week non-goals

- GPT-5.6 in runtime enforcement;
- Studio/dashboard, hosted control plane, authentication, billing, workspaces, or enterprise permissions;
- OpenAPI ingestion;
- wrapper or failure-test generation in Iteration 2;
- fabricated `generate`, `verify`, approval, or `report` success;
- multiple new provider integrations;
- production manual-reconciliation controls;
- a generic chatbot or workflow engine;
- package publication or deployment.
