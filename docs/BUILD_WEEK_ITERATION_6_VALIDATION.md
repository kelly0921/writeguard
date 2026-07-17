# Build Week Iteration 6 validation

Status: private remote, PostgreSQL CI, and Linux evaluation verified; the Windows test-fixture correction is locally validated and pending owner-approved push; external evaluators remain pending.

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
- Fresh private-remote clone of `1d4a4c52141a0a221caf209884959bfbf5438f8a` passed frozen install and the documented canonical evaluation in 47.5 seconds. Final-candidate fresh-clone evidence remains pending.

## Pending evidence

- Owner approval and push of the locally validated Windows test-fixture correction
- Green remote Windows evaluation
- Final-candidate fresh-clone judge instructions
- Unaffiliated evaluator 1
- Unaffiliated evaluator 2
- P0/P1 triage and any retest
- Three consecutive canonical evaluations at final freeze
- Final Iteration 6 gate
- Final commit and annotated tag
- Owner-provided private `/feedback` Session ID

Stripe test-mode validation remains pending and unauthorized. It is not a blocker for the simulated release candidate.

No package, media, or Devpost submission has been published or uploaded. Repository changes exist only in the owner-approved private GitHub repository.
