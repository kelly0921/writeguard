# OpenAI Build Week — Iteration 4 Validation

Date: July 17, 2026

Status: complete locally; checkpoint creation follows final repository checks

## Verified customer outcome

WriteGuard can now independently verify a generated integration through one public, offline workflow. A developer can determine whether the manifest-owned artifacts and their complete source/analysis/review/generator bindings still match, whether the generated TypeScript compiles against supported public packages, whether the deterministic generated failure tests pass when explicitly enabled, whether a provider implementation has been supplied, which guarantees were established, and which provider-specific guarantees remain unverified.

The default command is static and does not execute generated JavaScript:

```text
writeguard verify <generated-directory> --pretty
```

Generated test execution is a separate explicit boundary:

```text
writeguard verify <generated-directory> --run-tests --pretty
```

An explicitly identified provider implementation can be included in controlled compilation with `--provider-file <relative-path>`. `--strict` rejects unrelated extra files. JSON is the only stdout format; `--pretty` changes formatting only. Exit code `0` represents a valid `passed` or `passed_with_limitations` receipt, and exit code `6` represents failed verification or a fatal verifier error.

## Verification levels and limitations

The stable product contract is `writeguard.verification/v1` and reports five independent levels:

1. Artifact integrity: manifest, inventory, paths, sizes, digests, supported versions, and source/analysis/approved-review/generator bindings.
2. Compilation: generated TypeScript typechecks against public package surfaces using verifier-controlled compiler arguments.
3. Simulated failure behavior: manifest-owned generated tests execute only after `--run-tests`.
4. Provider integration completeness: required executor, reconciliation, and verification hooks are identified and an explicitly supplied provider file is typechecked.
5. Real-provider semantics: `not_run` unless a separate provider-specific conformance workflow genuinely runs.

SHA-256 digests establish integrity and binding, not authorship, authenticity, or trust in the original inputs. Compilation does not establish provider correctness. Simulated providers and generated tests do not establish real-provider idempotency, reconciliation, consistency, or verification semantics.

## Static and execution safety boundary

Static verification is the default. It validates manifest and bundle contracts, absolute/traversal/case-collision/duplicate paths, symlinks and root containment, file inventory and size limits, file and bundle digests, complete provenance bindings, approval state, unresolved template markers, private imports, OpenAI runtime dependencies, credential-shaped values, provider-boundary shape, and controlled TypeScript compilation. Target `tsconfig.json`, TypeScript plugins, lifecycle hooks, and package scripts are not loaded.

`--run-tests` first requires passing artifact integrity and compilation. It uses fixed compiler and Node test-runner arguments, executes only the manifest-owned generated test, applies time and output limits, removes verifier-owned temporary output, and passes a minimized environment with OpenAI, Stripe, and `NODE_OPTIONS` excluded. This is controlled child-process execution, not a security sandbox, and network isolation is not claimed.

Extra user files are allowed and reported by default, cannot influence generated-artifact integrity, and are not executed. `--strict` rejects them except for the explicitly supplied provider file.

## Verification receipt

The deterministic receipt payload contains verifier identity and version, verification mode, input and output digests, executed and skipped checks, status and evidence for each level, sanitized diagnostics, limitations, next actions, and overall result. It uses `passed`, `failed`, `passed_with_limitations`, `not_run`, and `not_applicable` without collapsing missing evidence into success or failure. Runtime timing is returned separately and excluded from receipt hashing.

The same runtime-validated receipt can be consumed by the CLI, CI policy, a future UI, or a future hosted service. No signature or authenticity claim is made.

## External-consumer pilots

Both required pilots installed packed `@closure/writeguard@0.7.0` and `@closure/writeguard-generator@0.2.0` tarballs into clean system-temporary consumer directories. They used public exports only, contained no workspace aliases or private imports, required no network after dependency preparation, made zero OpenAI calls, and produced valid sanitized receipts.

### Refund pilot

- Direct MCP-style consequential refund tool.
- Deterministic recorded analysis, explicit review and approval, deterministic generation, static verification, controlled generated tests, consumer compilation, and three pilot-specific tests all passed.
- Identity fields: `tenantId`, `orderId`.
- Redaction field: `paymentIntentId`.
- Unsafe retry created two simulated refund effects.
- Guarded concurrent and retry paths created one simulated effect under the approved reconciliation assumptions.
- Static and controlled-test receipts were `passed_with_limitations`.
- Real-provider semantics were `not_run`; the simulator is not described as Stripe.

### Email pilot

- Separate MCP-style consequential email-send tool and provider boundary.
- Deterministic recorded analysis, explicit review and approval, deterministic generation, static verification, controlled generated tests, consumer compilation, and three pilot-specific tests all passed.
- Identity fields: `tenantId`, `messageId`, intentionally different from the refund pilot.
- Redaction fields: `body`, `recipientEmail`, `subject`.
- Unsafe retry created two simulated sends.
- Guarded timeout-after-apparent-success and concurrent paths created one simulated send under the documented reconciliation behavior.
- Provider-generated message identifiers were modeled without inventing unsupported provider guarantees.
- Static and controlled-test receipts were `passed_with_limitations`.
- Real-provider semantics were `not_run`; no real email was sent.

## Journey timing evidence

These measurements are classified, not conflated:

| Measurement | Refund | Email | Status |
| --- | ---: | ---: | --- |
| Automated execution | 24,660 ms | 21,681 ms | measured |
| Maintainer clean-room onboarding | — | — | pending manual stopwatch run |
| External-developer onboarding | — | — | pending an unaffiliated developer |

Automation duration is not onboarding time. The “first protected action in under ten minutes” customer outcome is not yet externally validated.

## Tests

Iteration 4 added 40 unit tests across the verification contract, CLI, and verifier suites. The final counts are:

- 145 deterministic unit tests across 21 files.
- 20 PostgreSQL/MCP/concurrency/crash/pilot integration tests across 7 files.
- 165 repository tests.
- 5 separately generated failure scenarios.
- 6 pilot-specific tests across the refund and email clean consumers.
- 176 unique automated test definitions in the complete Iteration 4 journey.

The complete five-scenario generated-artifact suite was stress-run three consecutive times after increasing the generated test harness lease from an unsafe 5 ms to 30 seconds; all 15 scenario executions passed, including the concurrency scenario in every run. This changes only deterministic test timing, not production defaults or the execution architecture.

## Final validation commands and results

The authoritative aggregate command was:

```text
pnpm validate:build-week-iteration-4
```

It completed from `2026-07-17T06:27:43.272Z` through `2026-07-17T06:42:21.414Z` in 878,142 ms inside the report, or 881.1 seconds including the command launcher. Every aggregate check passed:

| Command/check | Result | Duration |
| --- | ---: | ---: |
| Existing sanitized GPT-5.6 evaluation report | 9/9 passed | 153,210 ms |
| `pnpm install --frozen-lockfile` | passed | 1,999 ms |
| `pnpm --filter @closure/writeguard build` | passed | 16,946 ms |
| `pnpm --filter @closure/writeguard-analyzer-openai build` | passed | 7,037 ms |
| `pnpm --filter @closure/writeguard-generator build` | passed | 6,427 ms |
| `pnpm validate:build-week-iteration-3` inherited regression | passed | 544,326 ms |
| `pnpm typecheck` | passed | 18,157 ms |
| `pnpm build` | passed | 16,905 ms |
| `pnpm test:unit` | 145 passed | 81,592 ms |
| `pnpm validate:generated-artifacts` | passed; 5/5 scenarios | 31,213 ms |
| `pnpm package:verify-generator` | passed | 66,271 ms |
| `pnpm validate:iteration-4-pilots` | refund and email passed | 66,350 ms |
| `pnpm verify:core-openai-boundary` | passed | 2,554 ms |
| `pnpm verify:generator-boundary` | passed | 2,190 ms |
| `pnpm package:inspect` | passed | 14,145 ms |
| `pnpm security:scan` | passed | 2,011 ms |

The inherited Iteration 3 gate also passed its frozen install; Build Week Iteration 1 regression; PostgreSQL migrations; 145 current unit tests; 20 PostgreSQL, MCP, multi-worker concurrency, child-process crash, shadow, starter, and pilot integration tests; public demos; package and declaration consumers; analyzer deterministic evaluation; generated project tests; SBOM; advisory audit; export redaction; core and generator dependency boundaries; tarball checks; and final secret scan. Its script retains historical Iteration 3 count labels in its own report, while the Iteration 4 aggregate records the current 145/20/165 counts.

The live GPT-5.6 gate was not rerun because no secure OpenAI key was present in the validation process. The existing sanitized `gpt-5.6` report was schema-checked and confirmed 9/9 passed. Generation and verification each made zero OpenAI calls.

### Corrective validation evidence

Validation found and corrected three development-time issues before the final passing gate:

- OneDrive intermittently rejected atomic fixture publication with `EPERM`; verifier test roots were moved to the operating-system temporary directory while retaining package-resolution junctions.
- Unbounded inherited subprocess output could keep the Windows aggregate handle open after its useful work; the Iteration 4 runner now captures bounded output, emits compact summaries, destroys completed streams, and applies per-step timeouts.
- A 5 ms generated-test claim lease could expire between claim and submission under load; the deterministic generated harness now uses a 30-second lease and 5-second wait, with a regression assertion and three consecutive passing generated-artifact runs.
- Package-consuming tests could observe stale local build output; the aggregate now builds all three public packages immediately after the frozen install.

No failed development run was counted as completion. Only the final complete aggregate is the exit-criteria result.

## Versions

| Component | Version |
| --- | --- |
| `@closure/writeguard` | `0.7.0` |
| `@closure/writeguard-analyzer-openai` | `0.1.1` unchanged |
| `@closure/writeguard-generator` | `0.2.0` |
| Analysis contract | `writeguard.analysis/v1` |
| Generation contract | `writeguard.generation/v1` |
| Generation manifest | `writeguard.generation-manifest/v1` |
| Verification bundle | `writeguard.verification-bundle/v1` |
| Verification receipt | `writeguard.verification/v1` |

## Documentation and security decisions

Iteration 4 updates the root README, `BUILD_WEEK.md`, security guidance, compatibility and support policy, CLI README, analysis product contract, generator README and changelog, core changelog, semver/package metadata, this validation report, the verification product contract, the pilot runbook, feedback template, and both pilot READMEs.

Security decisions include static verification by default; explicit code-execution opt-in; integrity failure before execution; fixed compiler/test arguments; no package-script or target-tsconfig trust; symlink/path/case/size controls; bounded diagnostics; minimal child environment; private-import, OpenAI-dependency, unresolved-marker, and credential-pattern rejection; deterministic receipts without runtime timing; and explicit non-claims for authenticity, sandboxing, and real-provider behavior.

The final secret scan passed. No OpenAI, Stripe, email-provider, or other credential exists in tracked, generated, pilot, or receipt output. The previously exposed Stripe key was not printed, recovered, or reused.

## Known limitations

- Real-provider semantics remain `not_run` for both required pilots.
- Provider-file presence and compilation establish integration completeness only, not semantic correctness.
- Controlled child processes are not a security sandbox and do not claim network isolation.
- Receipts are integrity-bound but are not signed and do not establish authenticity.
- Durable PostgreSQL deployment and provider-specific reconciliation remain developer responsibilities.
- Maintainer clean-room and external-developer onboarding measurements are still pending.
- No Studio, dashboard, hosted control plane, authentication, billing, deployment, or package publication is included.

## Iteration 5 recommendation

Iteration 5 should define a public provider-adapter conformance contract and CI receipt policy, implement one real test-mode provider adapter using a freshly rotated credential and provider-native idempotency/reconciliation semantics, and run the documented clean-room journey with at least two unaffiliated developers. The milestone should prioritize real-provider evidence and externally measured comprehension before any Studio or hosted control plane.

## Local checkpoint and external-state confirmation

After final documentation, type, whitespace, secret, and service checks pass, the authorized local checkpoint is:

- Commit message: `build-week(iteration-4): add generated integration verification and pilots`
- Annotated tag: `build-week-iteration-4`

Nothing was pushed, published, deployed, uploaded, or opened as a pull request by the Iteration 4 workflow.
