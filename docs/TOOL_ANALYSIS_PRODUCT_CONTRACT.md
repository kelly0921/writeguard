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

Iteration 1 implements step 2 and the contracts/boundaries for steps 3–5. It does not claim steps 3, 6, or 7 as a complete product workflow.

## Trust and control boundary

```text
MCP definition
  -> deterministic normalizer
  -> versioned normalized source
  -> optional GPT-5.6 analyzer (future, design-time only)
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

The supported Iteration 1 input is one MCP-style tool definition containing `name`, optional `description`, object-shaped `inputSchema`, and relevant MCP annotations. Normalization is domain-neutral. Refund, email, account mutation, infrastructure, and read-only tools use the same code path. The normalizer does not classify risk and never calls a model or network service.

Future adapters may normalize OpenAPI operations, framework tool declarations, or other IDLs into the same `NormalizedToolDefinition`. OpenAPI ingestion is explicitly not implemented during Iteration 1.

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

Iteration 1 implements:

```text
writeguard normalize-mcp <tool-definition.json|->
```

`analyze`, `generate`, `verify`, and `report` are documented direction only until they can perform honest work. A future UI must use `@closure/writeguard/analysis` rather than a parallel contract.

## Versioning and compatibility

- `writeguard.analysis/v1` is independent of the npm package version.
- Breaking changes require a new contract version and explicit parser/migration path.
- Unknown versions fail with actionable errors and are never silently coerced.
- The 0.4.0 package adds `./analysis` and a CLI bin without removing `.` or `./testing`.
- Generated artifacts must record the contract version and source/analysis digest.
- A future optional GPT package should depend on these contracts; the deterministic package must not depend on that implementation.

## Security, privacy, and redaction

- Tool definitions are schemas, not runtime inputs; callers must not embed credentials or customer values in defaults/examples.
- The normalizer rejects common credential-shaped values in metadata/schema.
- Sensitive-field paths are deterministic review hints, not a complete data-classification system.
- Source content is never uploaded by the normalizer or CLI.
- Analyzer implementations receive only validated normalized tools and must return validated risk-analysis artifacts.
- Future prompts, logs, generated files, and UI views must preserve WriteGuard's minimal-data and redaction guarantees.

## Explicit Build Week non-goals

- GPT-5.6 in runtime enforcement;
- Studio/dashboard, hosted control plane, authentication, billing, workspaces, or enterprise permissions;
- OpenAPI ingestion;
- wrapper or failure-test generation in Iteration 1;
- fabricated `analyze`, `generate`, `verify`, or `report` success;
- multiple new provider integrations;
- production manual-reconciliation controls;
- a generic chatbot or workflow engine;
- package publication or deployment.
