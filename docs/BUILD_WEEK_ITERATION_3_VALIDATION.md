# OpenAI Build Week — Iteration 3 Validation

Date: July 16, 2026
Status: complete locally

## Customer outcome

WriteGuard can now turn a normalized MCP tool definition and a bound analysis into a reviewable, explicitly approved, deterministic guarded-wrapper project. The generated project contains typed input handling, an enforcement configuration, provider execution/reconciliation/verification boundaries, and executable failure tests. Generation remains offline and makes zero OpenAI calls.

This iteration does not claim that an arbitrary provider integration is production-ready. A customer must implement and validate the generated provider hooks, use durable PostgreSQL-backed enforcement in production, and confirm tool-specific operation identity and reconciliation semantics during approval.

## Live OpenAI analyzer gate

The live evaluation initially exposed provenance mismatches for consequential operations. The root cause was prompt ambiguity: the model was not required to cite the normalized tool name exactly, and ambiguous classifications were not constrained to a low-confidence uncertain result. The prompt was narrowed to require the exact `untrustedToolDefinition.tool.name` evidence reference and to classify ambiguous operations as uncertain with confidence below `0.7`.

After that bounded change, all nine live scenarios passed:

1. Read-only lookup
2. Refund consequential write
3. Send-email consequential write
4. Missing identity
5. Unsupported reconciliation
6. Ambiguous operation
7. Description prompt injection
8. Nested-schema prompt injection
9. Sensitive fields

The sanitized report is stored locally at `.writeguard/openai-live-evaluation.json`. It contains no raw prompts, raw responses, or API key material. The successful run used `gpt-5.6`, `openai` `6.47.0`, made zero retries, and completed in 153,210 ms.

## Approval and generation contracts

The public generation contract is `writeguard.generation/v1`. Review records bind the normalized tool provenance and source digest, analysis digest and version, analyzer and model identity, selected operation, complete operation identity, guard promotion, reconciliation policy, redactions, and failure scenarios.

The workflow deliberately separates three steps:

```text
writeguard review   -> draft review, no approval acknowledgements
writeguard approve  -> explicit reviewer acknowledgements and identity confirmation
writeguard generate -> deterministic project generation from the approved record
```

Approval cannot be inferred from the analysis itself. It requires explicit acknowledgement of the enforcement and provider-hook responsibilities, and it rejects changed provenance, digests, operation identity, capabilities, reconciliation, or failure scenarios. App-supplied operation keys require an explicit confirmation and a provider implementation.

## Generated artifacts and public API

The new `@closure/writeguard-generator` package exports a descriptor, deterministic generator, staged publisher, sanitizer, and contract constants. A successful generation produces:

- `README.md`
- `package.json`
- `tsconfig.json`
- `src/input.ts`
- `src/writeguard-config.ts`
- `src/provider.ts`
- `src/guarded-tool.ts`
- `test/failure.test.ts`
- `writeguard-generation.json`

The manifest records the source, analysis, and review digests; generator and contract versions; file digests; approved failure scenarios; and known limitations. The publisher verifies those digests and uses staged, atomic publication into a new directory. It refuses existing output, traversal, unsafe paths, symlink ancestors, and partial publication.

## Determinism and security boundary

Standard review, approval, and generation require no network access, OpenAI dependency, or API key. Generated content excludes untrusted descriptions, escapes provider-facing strings, sanitizes identifiers, rejects prototype-pollution-shaped keys, and rejects unsupported schema composition and reference constructs. Input schemas are bounded by byte size, property count, and nesting depth.

Generated wrappers require provider-supplied execution, reconciliation, and verification hooks. Durable PostgreSQL enforcement is the production path; the in-memory adapter is explicitly restricted to tests. The generator does not invent provider idempotency or reconciliation semantics.

## Validation results

The aggregate command `pnpm validate:build-week-iteration-3` completed successfully. Its sanitized report is stored locally at `.writeguard/build-week-iteration-3.json`.

| Validation | Result | Duration |
| --- | ---: | ---: |
| Live OpenAI gate | 9/9 passed | 153,210 ms |
| Frozen analyzer evaluation | passed | 823 ms |
| Full regression suite | passed | 238,665 ms |
| Typecheck | passed | 15,310 ms |
| Build | passed | 15,746 ms |
| Unit tests | 105 passed | 32,827 ms |
| Generated-project validation | 5 passed | 18,589 ms |
| Analyzer clean consumer | passed | 48,495 ms |
| Generator clean consumer | passed | 34,805 ms |
| Core dependency boundary | passed | 2,988 ms |
| Generator dependency boundary | passed | 3,451 ms |
| Secret scan | passed | 2,664 ms |

Repository totals are 105 unit tests across 18 files, 20 PostgreSQL integration tests across 7 files, and 5 separately generated failure tests: concurrent execution, duplicate delivery, crash after provider success, delayed reconciliation, and retry after timeout. The total existing repository test count is 125, excluding the separately generated project tests.

The full regression also validated PostgreSQL migrations, a clean core consumer, starter and public demos, concurrency and crash recovery, the package tarball, SBOM generation, dependency audit, shadow and enforced pilot paths, pilot export redaction, doctor/report commands, normalized fixtures, and secret scanning. The final aggregate ran from `2026-07-17T01:18:41.498Z` through `2026-07-17T01:25:35.888Z` and completed in 414,390 ms. Two earlier aggregate attempts stopped before product validation because the expected local PostgreSQL service was not running; after starting the repository service, the complete aggregate passed.

## Version and package result

| Component | Version |
| --- | --- |
| `@closure/writeguard` | `0.6.0` |
| `@closure/writeguard-analyzer-openai` | `0.1.1` |
| `@closure/writeguard-generator` | `0.1.0` |
| Analysis contract | `writeguard.analysis/v1` |
| Generation contract | `writeguard.generation/v1` |

Clean-consumer verification confirmed public declarations, programmatic generation, staged publication, provenance behavior, missing-key handling, and that neither the core nor generator production dependency graph contains OpenAI. The generated SBOM contains 14 runtime components, and the dependency audit reported zero known vulnerabilities.

## Known limitations

- Provider hooks are generated as explicit boundaries and still require customer implementation and provider-specific testing.
- The supported input-schema subset intentionally excludes `$ref`, `$defs`, `oneOf`, `anyOf`, and `allOf`.
- App-supplied operation identity cannot be considered production-safe until the provider hook maps the full approved input identity to a durable key.
- Reconciliation is limited to operations whose analyzer result and reviewer approval establish a supported strategy.
- No UI, hosted control plane, deployment workflow, or remote artifact publication is included.
- No package, image, report, source branch, or tag has been pushed or published by the validation workflow.

## Iteration 4 recommendation

Prioritize verification and an under-ten-minute external fixture journey. Add a `writeguard verify` workflow that consumes the generation manifest plus provider evidence, runs the generated failure suite and provider-specific hook checks, and emits a signed or tamper-evident sanitized receipt. Validate that workflow with at least two external pilot fixtures before investing in a UI or hosted control plane.

## Repository handoff

The authorized local milestone commit and annotated `build-week-iteration-3` tag are created only after final documentation, whitespace, type, and secret checks pass. Nothing in this iteration authorizes a push, package publication, deployment, artifact upload, or customer communication.
