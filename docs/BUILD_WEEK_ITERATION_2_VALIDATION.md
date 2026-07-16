# Build Week Iteration 2 Validation

Date: July 16, 2026

Status: **Deterministic Iteration 2 implementation and all available local quality gates complete. Live GPT-5.6 model-quality evaluation pending because `OPENAI_API_KEY` was not configured. Iteration 2 is not represented as fully complete until that live gate passes.**

## Product outcome

A developer can now supply one direct MCP tool definition to `writeguard analyze` and receive exactly one structured, reviewable `RiskAnalysisResult` from the optional GPT-5.6 analyzer path. Deterministic normalization runs first. Successful output is bound to the normalized source digest, identifies `openai.gpt-5.6`, remains `recommendation_only`, and contains shadow-mode proposals that require developer approval.

The model cannot set the contract version, provenance, analyzer descriptor, recommendation status, or review state. Trusted code attaches those fields and validates the existing `writeguard.analysis/v1` contract. No model is imported into execution, storage, reconciliation, verification, or tracing.

## Honest provenance

The repository began Build Week with an unborn `HEAD`. The authorized Iteration 1 checkpoint now exists at commit `9ecedf4` with annotated tag `build-week-iteration-1`. This is explicitly the start of local Git-based Build Week history, not the beginning of the pre-existing product. Public npm returned `E404` for `@closure/writeguard@0.3.0`; timestamp, integrity, shasum, and other registry metadata remain unavailable and are not fabricated.

Iteration 2 advances the unreleased core line from 0.4.0 to 0.5.0 and introduces unreleased `@closure/writeguard-analyzer-openai@0.1.0`. Nothing was pushed, published, deployed, or uploaded as a release.

## Optional package architecture

`packages/analyzer-openai`:

- depends on public `@closure/writeguard/analysis`, `openai@6.47.0`, and Zod;
- implements the public `ToolRiskAnalyzer` interface without importing private core internals;
- exposes `createOpenAIToolRiskAnalyzer`, `OpenAIToolRiskAnalyzer`, `OpenAIResponsesTransport`, injectable transport types, actionable error codes, `OPENAI_ANALYZER_MODEL`, and a fixed descriptor;
- accepts only a runtime-validated `NormalizedToolDefinition`;
- supports fake transports that require no API key, network, or spend;
- emits generated JavaScript, declarations, maps, explicit package exports, README, and changelog;
- is dynamically loaded by the core CLI and is never imported by guarded execution.

`pnpm verify:core-openai-boundary` confirms the `@closure/writeguard@0.5.0` manifest and complete production dependency graph contain no OpenAI SDK.

## Official OpenAI integration verified

Current official OpenAI developer documentation and the installed SDK types were checked before implementation. The implemented pattern is:

- official `openai` JavaScript SDK 6.47.0;
- `client.responses.parse(...)`;
- fixed `model: "gpt-5.6"` with no silent fallback;
- `text.format = zodTextFormat(strictSchema, "writeguard_risk_analysis")`;
- parsed success from `response.output_parsed`;
- refusal inspection in response message content;
- incomplete handling through `response.status` and `incomplete_details.reason`;
- per-request timeout plus SDK error/status classification;
- one SDK retry by default, limited to the SDK's transient retry categories, configurable down to zero.

The official documentation, installed 6.47.0 types, generated strict JSON Schema, and deterministic mocked Responses call agreed on these parameter names and shapes. No documentation/type discrepancy required a workaround. The configured account could not be runtime-verified because no OpenAI key was present.

## Trust, privacy, and failure behavior

Every tool name, description, annotation, property name, nested property description, default, and example is placed in a canonical JSON data envelope and identified as untrusted. System instructions prohibit following tool-contained instructions, executing tools, changing schemas, claiming approval, inventing guarantees, or revealing secrets.

Layered controls include strict structured output, runtime validation, trusted envelope attachment, final descriptor/provenance verification, real input-field checks, required deterministic redaction coverage, and conservative rejection of unsupported idempotency, reconciliation, and installed-adapter claims. These controls reduce prompt-injection risk; they do not make an immunity claim.

The complete normalized definition is sent to OpenAI during live analysis. Callers must remove real secrets, personal data, and confidential defaults/examples first. The normalizer's credential-shape rejection and sensitive-field detection are heuristics, not full data-loss prevention. Errors and validation reports contain no API key, raw prompt, raw model response, or full tool input.

Missing key, authentication, model access, rate limit, timeout, network, service, refusal, incomplete response, invalid structured output, public-schema failure, provenance mismatch, contract-version mismatch, model mismatch, and unsupported-capability paths fail closed with actionable errors. No failure silently becomes a low-confidence success.

## CLI behavior

```text
writeguard analyze <tool-definition.json|-> [--pretty]
  [--server-name <name>] [--server-version <version>] [--source-label <label>]
```

The command reads one direct MCP tool definition, parses and normalizes it deterministically, loads the optional analyzer, requests one GPT-5.6 recommendation, verifies it, and emits canonical JSON to stdout. Errors stay on stderr. Input errors exit 3; analyzer/package/key/model/safety failures exit 4. No partial JSON is emitted on failure. The analyzer ID in successful output makes the model target visible.

`normalize-mcp` remains available without a model or network. `--out` was not added because the existing CLI has no file-output convention.

## Evaluation suite

The standard suite uses fake transports and made zero OpenAI requests. All twelve required categories pass:

1. read-only lookup remains risk `none` with no consequential candidates or proposals;
2. refund identifies financial, duplicate, timeout, concurrency, crash, and reconciliation risks without invented idempotency;
3. email identifies communication risk, separates identity from recipient/content, and includes redaction;
4. missing identity uses application-supplied identity with no fabricated input field;
5. unsupported reconciliation remains unsupported without provider lookup evidence;
6. ambiguous operation uses low confidence and uncertain classification;
7. description prompt injection cannot approve policy or alter provenance;
8. nested schema prompt injection remains untrusted data;
9. credentials, tokens, contact data, payment identifiers, and content receive redaction consideration;
10. a structurally valid final result with the wrong digest is rejected;
11. invalid structured output fails closed;
12. low-confidence output remains recommendation-only and developer-reviewable.

Additional tests cover the official Responses parse shape, strict JSON Schema generation, missing key, 401, 403, 404, 429, timeout, connection failure, 5xx, refusal, incomplete output, model mismatch, unsupported lookup, unsupported contract version, and package dependency placement.

Iteration 2 adds 28 unit tests: 27 optional-analyzer tests plus one net-new CLI test. Final unique count is **72 unit + 20 integration = 92 tests**, all passing.

## Validation commands and results

| Command | Result |
|---|---|
| `npm view openai version --json` | Passed; current registry version 6.47.0 |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm typecheck` | Passed under strict NodeNext TypeScript 5.9.3 |
| `pnpm --filter @closure/writeguard build` | Passed; core JS, declarations, CLI, analysis subpath, and migrations |
| `pnpm --filter @closure/writeguard-analyzer-openai build` | Passed; optional package JS, declarations, and maps |
| `pnpm test:unit` | Passed; 72/72, no OpenAI network calls |
| `pnpm test:integration` through the inherited readiness gate | Passed; 20/20 PostgreSQL/MCP/support/concurrency/shadow/starter/pilot tests |
| `pnpm package:verify` | Passed; clean core 0.5.0 consumer, declarations, CLI bin, one-effect recovery proof |
| `pnpm package:verify-openai-analyzer` | Passed; both tarballs, clean npm consumer, public fake transport, declarations, provenance, packaged missing-key failure, zero model calls |
| `pnpm package:inspect` | Passed; expected explicit exports and public migrations only |
| `pnpm verify:core-openai-boundary` | Passed; no OpenAI SDK in the core manifest or production graph |
| `pnpm security:sbom` | Passed; CycloneDX core runtime SBOM generated |
| `pnpm security:audit` | Passed; no known production dependency vulnerabilities reported |
| `pnpm security:scan` | Passed; no credential-shaped repository values |
| `pnpm eval:openai-live` without a key | Correctly refused before any request and printed secure setup guidance; live result remains pending |
| `pnpm validate:build-week-iteration-2` | Passed in 229.4 seconds after the required local PostgreSQL service was started |

The first aggregate attempt stopped before tests because PostgreSQL port 54327 was not running (`ECONNREFUSED`). Starting the existing Compose `postgres` service resolved the environment prerequisite; the complete rerun passed, and the service was stopped afterward. This was not recorded as a code or test failure.

The aggregate validator also passed migrations, frozen pre-existing design-partner and pilot readiness, ten-worker deduplication, real child-process crash recovery, starter/public/ordinary/MCP demos, shadow and enforced pilot modes, doctor, sanitized export verification, aggregate reports, and Compose cleanup.

No lint script exists, so no lint claim is made.

## Live GPT-5.6 gate

`OPENAI_API_KEY` was absent. No live OpenAI request was attempted, no API key was requested in chat, and no live model-quality result is claimed.

Secure PowerShell setup and the exact command:

```powershell
$secureKey = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [Net.NetworkCredential]::new("", $secureKey).Password
pnpm eval:openai-live
Remove-Item Env:OPENAI_API_KEY
```

The live command runs nine safe fixtures sequentially with zero retries and writes a sanitized `.writeguard/openai-live-evaluation.json` containing model identity, fixture name, pass/fail state, and diagnostic codes only. A passing live report is required before describing Iteration 2 as fully complete.

## Files and documentation

- Optional implementation: `packages/analyzer-openai`.
- CLI and core version wiring: `packages/writeguard/src/cli-program.ts`, package manifest/version/changelog/README, and lockfile.
- Evaluations: `fixtures/analyzer-evals`, `tests/openai-analyzer.test.ts`, and the updated CLI tests.
- External consumer: `fixtures/analyzer-package-consumer` and `scripts/verify-openai-analyzer-package.mjs`.
- Gates: core dependency boundary, live evaluation, and Iteration 2 aggregate validator scripts.
- Product/provenance/security/release docs: root README, `BUILD_WEEK.md`, tool-analysis contract, optional/core package READMEs and changelogs, compatibility, support, security, Iteration 1 provenance correction, and this report.

## Known limitations

- Live GPT-5.6 classification quality is unverified for the configured account.
- Analysis is probabilistic and cannot guarantee safety or complete prompt-injection resistance.
- Input remains one direct MCP tool definition; no live MCP server or OpenAPI ingestion is included.
- The 128 KiB normalized-input limit bounds cost exposure but is not token estimation.
- Provider capability evidence is conservative and still requires developer verification.
- Sensitive-field detection is heuristic; tool metadata may contain confidential values that do not match it.
- No approval CLI, wrapper generation, failure-test generation, verification command, UI, hosted service, publication, or deployment exists.
- No external developer has measured the complete under-ten-minute journey.

## Iteration 3 recommendation

First run and pass `pnpm eval:openai-live` with an authorized project that can access `gpt-5.6`, triage any fixture-quality failures without weakening provenance or capability checks, and record the sanitized report. Then implement a separate generator that accepts only a schema-valid analysis plus an explicit digest-bound approved `DeveloperReview`. Generate reviewable TypeScript wrapper and failure-test artifacts for one provider-hook fixture; never infer approval, provider idempotency, lookup semantics, or verification behavior. The generated suite should prove duplicate suppression, timeout-after-submission reconciliation, concurrent invocation safety, crash-after-effect recovery, ambiguous reconciliation review, and redaction before adding `writeguard generate`.

## Repository actions

The authorized local Iteration 2 commit message is `build-week(iteration-2): add GPT-5.6 tool risk analyzer`, followed by annotated tag `build-week-iteration-2`. No push, pull request, package publication, deployment, or external upload is authorized or performed.
