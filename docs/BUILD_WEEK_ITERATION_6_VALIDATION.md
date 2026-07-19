# Build Week Iteration 6 validation

Status: private remote, PostgreSQL CI, Windows evaluation, Linux evaluation, sanitized artifacts, and a final-candidate fresh clone are verified; external evaluators remain pending.

## Local evidence

- Sealed Iteration 5 commit/tag confirmed at `9981422094b30c245d779698f38ff39e822e13db`.
- Working tree was clean before Iteration 6 preparation.
- Private remote configured at `https://github.com/kelly0921/writeguard.git`; repository remains private with no public license.
- Repository inventory contains 249 tracked files totaling 1,172,728 bytes.
- No tracked absolute user paths or tracked local environment/database/log/cache/build artifacts were found.
- No OpenAI, Stripe, or database key was present.
- `pnpm evaluate:local` passes with 2 unsafe simulated effects, 1 guarded effect, passing policy/conformance, and real-provider semantics `not_run`.
- `pnpm security:scan` passed.
- `pnpm docs:scan` passed after preparation edits across 54 documentation/workflow files.
- `pnpm validate:evaluation-ci` passed with the expanded Windows/Linux release-candidate matrix workflow.
- Generator advanced by a patch release to `@closure/writeguard-generator@0.3.1` after remote Windows CI exposed a false positive caused by Windows short-path canonicalization.
- The verifier regression suite now has 172 passing unit tests, including a platform-directory-alias case while retaining generated-content symlink rejection.
- The Windows test fixture now creates generated projects under the repository volume before linking the repository dependency tree. All 172 unit tests, including controlled refund/email compilation and generated-test execution, pass locally with the same-volume invariant confirmed.
- After the fixture correction, typecheck, build, evaluation-workflow validation, generated-artifact validation, five generated failure tests, generator dependency-boundary validation, packed-generator clean-consumer verification, secret scan, and documentation hygiene all passed.
- A zero-artifact Windows clone passed public package builds, typecheck, repository build, 172 unit tests, generated-artifact validation, packed-generator installation, dependency-boundary checks, secret/document scans, and canonical evaluation.
- A fresh clone of private `master` at `5a0b5956a995cd7020fb4df880ad5d68a58eced7` passed frozen installation, the documented canonical evaluation, secret scan, and documentation hygiene. Automated evaluation time was 70.9 seconds; this is not developer onboarding time.
- A subsequent maintainer rerun passed in 52.6 seconds and reproduced evaluation-report SHA-256 `83671980ff311267dc95de9079e5505581e4311980b708764aff74d9553feebd`. This remains automated execution evidence, not external-developer timing.
- Iteration 6A created another private fresh clone from `master` at `5a0b5956a995cd7020fb4df880ad5d68a58eced7`. Node 24.17.0 and pnpm 11.9.0 completed frozen install and the exact README evaluator; the evaluator reported 88.773 seconds, and the clone-through-completion command sequence took 131.176 seconds. Both are maintainer-run command evidence, not external onboarding time.
- The Iteration 6A fresh-clone report used packed public packages, no workspace aliases or private imports, zero OpenAI/Stripe/other-provider calls after installation, and no PostgreSQL. All seven evidence files parsed; credential-shape and absolute-home-path scans were clean; the report digest remained `d3c3707861b864a43632fddc1b62997c14bc8b92bab593e67c577001bb18889b`.
- The external-tester follow-up command normalized `fixtures/mcp-tools/send-email.json` from the same fresh clone, returned exit code zero, and identified `recipientEmail` as sensitive. The temporary clone remained clean and was removed only after the sanitized evidence was recorded.
- LF checkout policy reproduced canonical report digest `d3c3707861b864a43632fddc1b62997c14bc8b92bab593e67c577001bb18889b` across the workspace and clean clone without normalizing verifier input bytes at runtime.
- Release manifest package versions and all three packed-artifact hashes were validated locally; the generator tarball is 48,193 bytes with SHA-256 `f5a22286a391a1f35a7a55a179693231854f8e252e134577c48e91022d7c8098`.
- No validation service remains running.
- Public package tarball hashes are recorded in `docs/RELEASE_CANDIDATE_MANIFEST.json`.

## Remote evidence

- Preparation commit `444664a7e43d1e9abfe4823ffe0b3cad981345c7` and annotated Iteration 1–5 tags were pushed only after owner approval.
- Clean-checkout ordering fix `1d4a4c52141a0a221caf209884959bfbf5438f8a` was pushed only after a second owner approval.
- [WriteGuard CI run 29588806949](https://github.com/kelly0921/writeguard/actions/runs/29588806949) passed the PostgreSQL-backed pilot gate.
- [WriteGuard evaluation run 29588806950](https://github.com/kelly0921/writeguard/actions/runs/29588806950) completed all Linux validation commands but failed hidden-directory artifact upload; Windows passed install, all public builds, typecheck, and repository build before verifier tests exposed the path-alias false positive.
- [WriteGuard evaluation run 29591395620](https://github.com/kelly0921/writeguard/actions/runs/29591395620) passed the complete Linux matrix including sanitized hidden-artifact upload. Windows again passed install, all public builds, typecheck, and repository build; its remaining failure was isolated to a test-only `node_modules` junction crossing the runner's `D:` repository and `C:` temporary volumes.
- [WriteGuard CI run 29591395955](https://github.com/kelly0921/writeguard/actions/runs/29591395955) passed the PostgreSQL-backed pilot gate.
- Windows fixture commit `5a0b5956a995cd7020fb4df880ad5d68a58eced7` was pushed only after a third owner approval.
- [WriteGuard evaluation run 29592547066](https://github.com/kelly0921/writeguard/actions/runs/29592547066) passed on both Windows and Linux. Both jobs passed frozen installation, public package builds, typecheck, repository build, all 172 unit tests, generated-artifact validation, packed-generator verification, dependency-boundary checks, secret/document scans, canonical evaluation, and sanitized artifact upload.
- [WriteGuard CI run 29592547198](https://github.com/kelly0921/writeguard/actions/runs/29592547198) passed the PostgreSQL-backed pilot gate.
- The Windows and Linux evaluation artifacts each contain the same seven expected sanitized files. All JSON parsed, credential-pattern scans passed, and deterministic report, policy, and adapter-conformance payloads matched across platforms. Runtime-bearing files differ as expected.
- An earlier private-remote clone of `1d4a4c52141a0a221caf209884959bfbf5438f8a` also passed frozen install and the documented canonical evaluation in 47.5 seconds.

## Iteration 6A repository and publication audit

- The remote is private `kelly0921/writeguard`, default branch `master`, with `HEAD` at `5a0b5956a995cd7020fb4df880ad5d68a58eced7`.
- `master` is the only remote branch. The preparation commit is an ancestor; the only later commits are the three separately approved CI corrections.
- Annotated tags `build-week-iteration-1` through `build-week-iteration-5` are present remotely and resolve to their documented commits.
- The remote tracks 257 files. Only `.env.example` and `.env.pilot.example` match environment-template names; no real `.env`, database, log, dependency tree, build output, personal document, or generated local report is tracked.
- Repository and evidence scans found no credential shape, absolute user path, OneDrive dependency, Bloomberg reference, or unsupported positive claim of production safety, universal exactly-once behavior, live GPT-5.6 in the offline evaluator, real-provider verification, external onboarding validation, or digest authenticity.
- Judge-facing drift was found locally in README/test totals, remote-CI status, repository URL, the nonexistent final Iteration 6 tag instruction, and fresh-clone status. Iteration 6A corrects those documentation issues without changing product or workflow code.
- The factual handoff is in `docs/BUILD_WEEK_SUBMISSION_EVIDENCE.md`, `docs/DEMO_CAPTURE_SHEET.md`, `docs/DEVPOST_FACTS_WORKSHEET.md`, and `docs/EXTERNAL_TESTER_HANDOFF.md`.
- After the documentation changes, all 172 unit tests, documentation hygiene across 57 files, the secret scan, release-manifest JSON parsing, relative-link checks, required-section checks, and the demo capture commands passed locally.

## Pending evidence

- Unaffiliated evaluator 1
- Unaffiliated evaluator 2
- P0/P1 triage and any retest
- Three consecutive canonical evaluations at final freeze
- Final Iteration 6 gate
- Final commit and annotated tag
- Owner-provided private `/feedback` Session ID

Stripe test-mode validation remains pending and unauthorized. It is not a blocker for the simulated release candidate.

No package, media, or Devpost submission has been published or uploaded. Repository changes exist only in the owner-approved private GitHub repository.
