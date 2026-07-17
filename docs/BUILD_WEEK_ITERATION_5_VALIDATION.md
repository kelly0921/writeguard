# Build Week Iteration 5 validation

## Customer outcome

The evaluation release candidate provides one zero-credential command that installs packed public packages into a clean consumer and produces machine-readable and human-readable evidence for the complete simulated WriteGuard journey. The final repository gate must pass before this document is marked complete or a checkpoint is created.

## Verified before final gate

- Iteration 4 commit and annotated tag resolve to `077fcf332ec175f4d68a489e6c57cfca68c9f098`.
- The unchanged Iteration 4 validation gate passed before edits.
- The pre-edit and post-preflight secret scans passed.
- The canonical `pnpm evaluate:local` completed locally on Windows without credentials or PostgreSQL.
- The run observed two unsafe simulated effects and one guarded simulated effect.
- Static verification and generated tests reported `passed_with_limitations`; adapter conformance and the evaluation policy passed; real-provider semantics remained `not_run`.
- Core 0.8.0, analyzer 0.1.1, and generator 0.3.0 compile and the repository typecheck passes.

## Final gate

`pnpm validate:build-week-iteration-5` passed on July 17, 2026 in 848.851 seconds:

| Check | Result | Duration |
|---|---|---:|
| Existing sanitized live GPT-5.6 evaluation | 9/9 passed, historical report reused | 153.210 s original runtime |
| `pnpm install --frozen-lockfile` | Passed | 1.765 s |
| Core 0.8.0 build | Passed | 8.039 s |
| Analyzer 0.1.1 build | Passed | 9.820 s |
| Generator 0.3.0 build | Passed | 8.370 s |
| `pnpm validate:build-week-iteration-4` | Passed | 727.983 s |
| `pnpm test:unit` | 171/171 passed | 49.648 s |
| `pnpm evaluate:local` | Passed | 39.201 s |
| `pnpm validate:evaluation-ci` | Passed | 1.205 s |
| `pnpm docs:scan` | Passed | 1.317 s |
| `pnpm security:scan` | Passed | 1.486 s |

The inherited Iteration 4 gate in turn passed:

- frozen installation and all three public builds;
- the Iteration 3 PostgreSQL, MCP, concurrency, crash, pilot, analyzer, package, SBOM, advisory-audit, frozen-install, public-demo, redaction, and secret gates;
- strict typecheck and repository build;
- repository unit coverage;
- five generated failure scenarios and deterministic artifact validation;
- clean packed generator generation, verification, declarations, packaged CLI, controlled tests, and receipt policy;
- packed refund and email pilots with six pilot-specific tests;
- core/generator OpenAI dependency boundaries;
- package/tarball inspection and final secret scan.

The repository contains 171 deterministic unit tests and 20 live PostgreSQL/MCP/concurrency/pilot integration tests: 191 repository tests. The canonical evaluation additionally executes five manifest-owned generated failure scenarios and six adapter-conformance scenarios.

The canonical evaluator's internal automated runtime was 37.645 seconds, including 9.752 seconds for the clean install. That value is classified as automated execution, not onboarding time. Maintainer clean-room and external-developer times remain pending.

The validation-only PostgreSQL container was stopped after the gate; `docker compose ps` reported no running service. A final credential scan passed. No live OpenAI evaluation was rerun and no Stripe test-mode conformance ran because no fresh secure key was available.

Generated local evidence:

- `.writeguard/build-week-iteration-5.json`
- `.writeguard/evaluation-report.json`
- `.writeguard/evaluation-summary.md`
- `.writeguard/evaluation-runtime.json`
- `.writeguard/evaluation-policy.json`
- `.writeguard/evaluation-adapter-conformance.json`

All remain ignored and contain no tracked absolute user path or credential.

## Honest limitations

- The canonical analysis is a recorded deterministic fixture, not a live call.
- The prior sanitized live 9/9 report is reused, but the exact raw response payload was not retained.
- The canonical provider and conformance evidence are simulated.
- Stripe test-mode conformance is pending because no fresh secure key was available.
- Remote GitHub Actions execution, external-developer timing, publication, deployment, and submission are unverified or not performed.
- A repository license decision remains pending.
