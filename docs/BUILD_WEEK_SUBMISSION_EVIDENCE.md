# Build Week submission evidence

Status: factual handoff for owner-reviewed submission work. This file is not marketing copy, a publication, or proof of submission.

## 1. One-sentence problem

When a consequential provider action succeeds but its acknowledgement is lost, an AI agent can retry under a new tool-call identity and accidentally repeat the real-world effect.

Evidence: `README.md`, `docs/FAILURE_MODEL.md`, and the two-effect unsafe path in `.writeguard/evaluation-report.json`.

## 2. Target user

Agent-tool, MCP, backend, platform, reliability, and payments developers integrating consequential external writes such as refunds, email delivery, deployments, or record mutations.

Evidence: `README.md` and `docs/PRODUCT_BOUNDARY.md`.

## 3. One-sentence solution

WriteGuard assigns stable business-operation identity, persists uncertainty, reconciles before retry, verifies provider results, and returns a reviewable receipt under an explicitly approved policy.

Evidence: `README.md`, `docs/ARCHITECTURE.md`, and `docs/TOOL_ANALYSIS_PRODUCT_CONTRACT.md`.

## 4. Complete product journey

`Tool -> Analyze -> Review -> Approve -> Generate -> Verify -> Integrate`

The boundaries are deliberate: analysis is recommendation-only; review is initially unapproved; approval requires a developer identity and acknowledgements; generation is deterministic; verification separates static checks from explicit generated-test execution; provider integration remains developer-owned.

Evidence: `docs/EVALUATION_RUNBOOK.md`, `docs/TOOL_ANALYSIS_PRODUCT_CONTRACT.md`, and `docs/VERIFICATION_PRODUCT_CONTRACT.md`.

## 5. Pre-Build Week functionality

The verified pre-Build Week 0.3.0 line already included:

- stable business-operation identity;
- PostgreSQL claims, cross-process recovery, and explicit `UNKNOWN`;
- provider reconciliation and postcondition verification;
- execution receipts and conservative review escalation;
- shadow observation and local telemetry;
- fake-provider and Stripe test-mode adapter paths;
- MCP, support, and design-partner examples;
- 26 unit tests and 20 integration tests.

These capabilities must not be described as Build Week inventions. Evidence: `BUILD_WEEK.md`, `docs/MILESTONE_4_VALIDATION.md`, and `docs/BUILD_WEEK_ITERATION_1_VALIDATION.md`.

## 6. Build Week Iterations 1-5

- Iteration 1: versioned analysis contracts, deterministic MCP normalization, provenance/digests, injectable analyzer boundary, and public CLI/export.
- Iteration 2: optional GPT-5.6 structured analysis, fail-closed model boundary, adversarial fixtures, and a sanitized live 9/9 evaluation.
- Iteration 3: explicit review/approve/generate contracts and CLI, deterministic typed wrappers, manifests, provider boundaries, and five generated failure scenarios.
- Iteration 4: safe-static and opt-in generated-integration verification, controlled compilation/tests, deterministic receipts, and packed refund/email consumers.
- Iteration 5: one zero-credential evaluation, receipt-derived summary, public adapter-conformance receipts, minimal CI policy, external-tester materials, and release evidence.

Evidence: `docs/BUILD_WEEK_ITERATION_1_VALIDATION.md` through `docs/BUILD_WEEK_ITERATION_5_VALIDATION.md` and the annotated tags in section 26.

## 7. How Codex accelerated development

Codex audited the existing architecture, implemented bounded additions to public contracts and CLIs, generated tests and documentation, ran clean package consumers and regression gates, diagnosed Windows/OneDrive and GitHub-runner path failures, and maintained validation evidence. This is a development-process fact; Codex does not substitute for external users, developer approval, or real-provider validation.

Evidence: the Iteration validation reports and commits in section 26.

## 8. How GPT-5.6 is used

GPT-5.6 is an optional design-time analyzer that returns runtime-validated, structured, recommendation-only tool-risk analysis. The credential-gated quality gate passed 9/9 sanitized fixtures. The canonical evaluator uses a deterministic recorded GPT-5.6-compatible fixture, labels it `recorded_fixture`, and makes no live model call.

Evidence: `docs/BUILD_WEEK_ITERATION_2_VALIDATION.md`, `docs/BUILD_WEEK_ITERATION_5_VALIDATION.md`, and `.writeguard/evaluation-report.json`.

## 9. Why GPT-5.6 is not in runtime enforcement

Runtime enforcement must remain deterministic, auditable, and available without a model or API key. Trusted code attaches analyzer identity, provenance, and approval state; the model does not approve policy, generate trusted bindings, decide runtime retries, or verify provider truth.

Evidence: `docs/TOOL_ANALYSIS_PRODUCT_CONTRACT.md`, `docs/ARCHITECTURE.md`, and the core/generator OpenAI dependency-boundary checks.

## 10. Developer approval boundary

`review` creates an unapproved draft. `approve` requires an explicit reviewer and required acknowledgements; there is no `--yes` bypass. The canonical receipt records approval as `approved` and `approvalWasInferred: false`.

Evidence: `README.md`, `tests/cli-generation.test.ts`, and `.writeguard/evaluation-report.json`.

## 11. Deterministic generation

Approved inputs generate typed wrapper, configuration, provider boundary, manifest, verification bundle, README, package metadata, and failure tests. Generation validates source/analysis/review/generator bindings, makes zero OpenAI calls, and is byte-deterministic for identical supported inputs.

Evidence: `packages/generator/README.md`, `tests/generator.test.ts`, and `scripts/validate-generated-artifacts.mjs`.

## 12. Verification and adapter-conformance model

Safe static verification checks manifest inventory, bounded paths and symlinks, file digests, full provenance bindings, imports, credential patterns, provider shape, and verifier-controlled TypeScript compilation without executing target JavaScript or package scripts. `--run-tests` explicitly executes only the integrity-verified manifest-owned generated test in a constrained child process; it is not a security sandbox. The separate public adapter kit runs six declared simulated scenarios.

Evidence: `docs/VERIFICATION_PRODUCT_CONTRACT.md`, `docs/VERIFICATION_POLICY.md`, `.writeguard/evaluation-static-verification.json`, `.writeguard/evaluation-generated-test-verification.json`, and `.writeguard/evaluation-adapter-conformance.json`.

## 13. Unsafe versus guarded results

The canonical deterministic provider demonstrates:

- unsafe simulated retry: 2 external effects;
- guarded simulated execution: 1 external effect;
- static verification: `passed_with_limitations`;
- generated failure tests: `passed_with_limitations`;
- adapter conformance: `passed`;
- CI receipt policy: `passed`;
- real-provider semantics: `not_run`.

Evidence: `pnpm evaluate:local` and `.writeguard/evaluation-report.json`.

## 14. Concurrency and crash-recovery evidence

The PostgreSQL suite exercises claiming, duplicate invocation, concurrency, lost acknowledgement, `UNKNOWN`, reconciliation, and recovery. The five generated scenarios cover concurrent invocation, duplicate request, crash after provider success, delayed reconciliation, and retry after timeout. These are bounded test guarantees, not universal exactly-once claims.

Evidence: `tests/concurrency.integration.test.ts`, `tests/postgres.integration.test.ts`, `scripts/validate-generated-artifacts.mjs`, and `docs/BUILD_WEEK_ITERATION_4_VALIDATION.md`.

## 15. Test counts

- Unit: 172.
- PostgreSQL/MCP/support/concurrency/shadow/starter/pilot integration: 20.
- Repository total: 192.
- Generated failure scenarios: 5.
- Adapter-conformance scenarios: 6.
- Packed refund/email pilot-specific tests: 6.
- Historical sanitized live GPT-5.6 analyzer fixtures: 9/9 passed.

Evidence: `docs/RELEASE_CANDIDATE_MANIFEST.json`, `docs/BUILD_WEEK_ITERATION_6_VALIDATION.md`, and the remote Actions runs in section 17.

## 16. Canonical evaluation runtime

- Maintainer local rerun on Windows: 52.560 seconds.
- Fresh private-clone evaluator runtime on Windows: 88.773 seconds.
- Fresh-clone sequence from clone start through evaluation completion: 131.176 seconds.

All values are automated or maintainer-run command time. None is external-developer onboarding time. Evidence: `.writeguard/evaluation-runtime.json` and `docs/BUILD_WEEK_ITERATION_6_VALIDATION.md`.

## 17. Remote Windows/Linux/PostgreSQL CI evidence

Validated commit: `5a0b5956a995cd7020fb4df880ad5d68a58eced7`.

- [WriteGuard evaluation run 29592547066](https://github.com/kelly0921/writeguard/actions/runs/29592547066), triggered by push on July 17, 2026:
  - Ubuntu job `87924936903`: 2026-07-17 15:32:43Z to 15:34:42Z, success.
  - Windows job `87924936987`: 2026-07-17 15:32:45Z to 15:36:21Z, success.
  - Both sanitized evaluation artifacts uploaded successfully.
- [WriteGuard CI run 29592547198](https://github.com/kelly0921/writeguard/actions/runs/29592547198):
  - Ubuntu/PostgreSQL `pilot-ready` job `87924937680`: 2026-07-17 15:32:43Z to 15:34:55Z, success.

Earlier failed runs and the narrow cross-platform/workflow corrections remain documented in `docs/BUILD_WEEK_ITERATION_6_VALIDATION.md`; checks were not weakened.

## 18. Fresh-clone evidence

On July 18, 2026, a new clone from `https://github.com/kelly0921/writeguard.git` resolved to `5a0b5956a995cd7020fb4df880ad5d68a58eced7`. With Node 24.17.0 and pnpm 11.9.0:

- `pnpm install --frozen-lockfile` exited zero;
- `pnpm evaluate:local` exited zero;
- all seven evidence files parsed;
- report digest was `d3c3707861b864a43632fddc1b62997c14bc8b92bab593e67c577001bb18889b`;
- packed public packages were used;
- workspace aliases and private imports were false;
- OpenAI, Stripe, and other provider calls were zero;
- PostgreSQL was not required;
- credential and absolute-path scans of evidence were clean;
- the tracked worktree remained clean.

This is maintainer fresh-clone evidence, not external-developer validation.

## 19. Security and privacy safeguards

- No credential-shaped value was found by `pnpm security:scan`.
- No real `.env`, database, log, generated report, dependency tree, or build output is tracked; `.env.example` and `.env.pilot.example` are templates.
- Generated evidence rejects credential shapes, absolute home paths, raw provider errors, and raw sensitive inputs.
- The optional analyzer is the only package with an OpenAI SDK dependency.
- Generation and verification require no key or model call.
- Sensitive metadata is redacted or fingerprinted.
- Private judge access, recording, uploads, package publication, and submission remain owner-controlled external actions.
- No license is included while the repository remains private.

Evidence: `scripts/scan-secrets.mjs`, `.gitignore`, `SECURITY.md`, `docs/ITERATION_6_LOCAL_RELEASE_AUDIT.md`, and the fresh-clone scan in section 18.

## 20. Known limitations

- Simulation does not establish Stripe, email, or other real-provider semantics.
- A negative provider lookup is not proof that an action never happened.
- Provider reconciliation and verification remain action-specific.
- Generated-test child-process execution is not a security sandbox.
- Digests prove integrity and binding, not authorship or authenticity.
- Controlled compilation proves public API compatibility, not provider correctness.
- Durable deployment requires reviewed provider hooks and PostgreSQL-backed storage.
- macOS is unvalidated.
- External onboarding and the under-ten-minute outcome remain unvalidated.
- The canonical analysis is recorded; no live GPT-5.6 call occurs.

Evidence: `README.md`, `docs/VERIFICATION_PRODUCT_CONTRACT.md`, and `.writeguard/evaluation-report.json`.

## 21. External-developer status

Zero unaffiliated external evaluations are complete. Two independent runs, timings, comprehension answers, and P0/P1 triage remain pending. Maintainer runs must not be relabeled as external validation.

Evidence: `docs/EXTERNAL_EVALUATION_GUIDE.md`, `docs/EXTERNAL_EVALUATION_RESULT_TEMPLATE.md`, and `docs/RELEASE_CANDIDATE_MANIFEST.json`.

## 22. Stripe status

The canonical evaluator makes zero Stripe calls. A historical founder-run Stripe test-mode demonstration is documented from July 15, 2026, but no fresh Iteration 6 Stripe key or provider-conformance run is authorized, and Stripe production semantics are not verified. Stripe is optional and not a release-candidate gate.

Evidence: `docs/MILESTONE_2_VALIDATION.md`, `README.md`, and `docs/RELEASE_CANDIDATE_MANIFEST.json`.

## 23. Exact judge commands

```powershell
git clone https://github.com/kelly0921/writeguard.git writeguard
cd writeguard
git checkout master
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm evaluate:local
Get-Content .writeguard/evaluation-summary.md
Get-Content .writeguard/evaluation-report.json
pnpm writeguard normalize-mcp fixtures/mcp-tools/send-email.json --pretty
```

Expected requirements and troubleshooting are in `docs/JUDGE_TESTING.md`. No key, Docker, or PostgreSQL is required.

## 24. Claims supported

- The simulated unsafe retry creates 2 effects and the guarded simulation creates 1.
- GPT-5.6 is used for optional design-time recommendation-only analysis.
- The canonical evaluator uses a recorded fixture and makes no live model call.
- Developer approval is separate and explicit.
- Generation is deterministic for supported inputs.
- Static integrity/provenance checks and public compilation pass.
- Manifest-owned generated failure tests pass with declared simulation limitations.
- The simulated adapter passes six public conformance scenarios.
- Windows, Ubuntu, and Ubuntu/PostgreSQL Actions passed for the named commit.
- The named private commit works from a maintainer fresh clone.

## 25. Claims prohibited or unsupported

Do not claim:

- production-safe or provider-certified;
- universal or unrestricted exactly-once execution;
- live GPT-5.6 during the canonical evaluator;
- real Stripe or email semantics from simulation;
- secure sandboxing of generated code;
- digest authenticity, authorship, or trust;
- public npm availability, deployment, or submission;
- macOS validation;
- external-developer validation or under-ten-minute onboarding before two real participants complete it.

## 26. Git commits and Build Week tags

Remote default branch: private `master` at `5a0b5956a995cd7020fb4df880ad5d68a58eced7`. The only post-preparation commits are the three owner-approved CI corrections.

| Ref | Annotated tag object | Commit | Subject |
|---|---|---|---|
| `build-week-iteration-1` | `5a869e27e1e01af1673e6fea7724dcd0514a758a` | `9ecedf4b4d35728aafb50ce1c40f18b782914352` | `build-week(iteration-1): add analysis contracts and MCP normalization` |
| `build-week-iteration-2` | `5895538ed20cbab13be8471d782c85306ae1c7eb` | `b77f4e4d22b4937e9363593d5151eb3f1e1c6077` | `build-week(iteration-2): add GPT-5.6 tool risk analyzer` |
| `build-week-iteration-3` | `057608f24b40f5826a1a1c3be7a033086a71f20f` | `ddb2fb0febc1de198cd26871a5a51d61dededcae` | `build-week(iteration-3): add approved wrapper and failure-test generation` |
| `build-week-iteration-4` | `21516a690beba14811e58511d978c98bacd61877` | `077fcf332ec175f4d68a489e6c57cfca68c9f098` | `build-week(iteration-4): add generated integration verification and pilots` |
| `build-week-iteration-5` | `339acc178da03bf0e6466e1071b9d7baaec79f5f` | `9981422094b30c245d779698f38ff39e822e13db` | `build-week(iteration-5): prepare evaluation release candidate` |
| preparation commit | n/a | `444664a7e43d1e9abfe4823ffe0b3cad981345c7` | `build-week(iteration-6-prep): add external validation and submission materials` |
| CI correction 1 | n/a | `1d4a4c52141a0a221caf209884959bfbf5438f8a` | `build-week(iteration-6-ci): fix clean-checkout validation ordering` |
| CI correction 2 | n/a | `a1ffd7ca442acc1082be2f8d89cecd0d79e7c20f` | `build-week(iteration-6-ci): fix cross-platform verifier evaluation` |
| CI correction 3 | n/a | `5a0b5956a995cd7020fb4df880ad5d68a58eced7` | `build-week(iteration-6-ci): keep verifier fixtures on workspace volume` |

All five Build Week tags are annotated and present remotely. No Iteration 6 final tag exists yet; final freeze remains gated on two external evaluations and owner approval.
