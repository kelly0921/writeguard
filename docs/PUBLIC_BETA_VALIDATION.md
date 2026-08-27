# Public Beta Validation

Date: August 27, 2026
Status: **code and documentation ready; GitHub visibility change pending authenticated owner action**

## Customer-facing outcome

WriteGuard now has a clean public-beta distribution boundary: an Apache-2.0 TypeScript SDK and CLI remain the product, provider conformance remains the extension surface, and an optional agent skill guides integration without gaining approval or runtime authority.

This validation does not establish production safety, real-provider correctness, external-developer onboarding, or npm availability.

## Repository isolation

The release was prepared from a clean checkout of `kelly0921/writeguard` at `e50048c`. Unrelated local application work was not copied into the release checkout. BeautyProof was preserved as its own Git repository outside the WriteGuard workspace before this gate ran.

## Public surfaces

- Added Apache License 2.0 and package license metadata.
- Added repository, issue, and contribution metadata for the three supported unreleased packages.
- Added `CONTRIBUTING.md`, issue forms, and a pull-request evidence checklist.
- Added the versioned distribution decision in `docs/DISTRIBUTION.md`.
- Added the repo-owned `skills/protect-agent-actions` integration skill.
- Added a current-source secret scan expansion and a redacted reachable-history scan.
- Added bounded retry handling for transient Windows staged-publication rename failures.
- Preserved the current `@closure/*` identities until npm namespace ownership and final names are verified.

## Validation results

| Check | Result |
|---|---|
| Frozen pnpm install | Passed with the patched lockfile |
| TypeScript package builds | Passed for core facade, analyzer, and generator/verifier |
| Root typecheck and build | Passed |
| Unit tests | 173/173 passed across 24 files |
| PostgreSQL/MCP/concurrency/crash/pilot integration tests | 20/20 passed across 7 files |
| Generated failure tests | 5/5 passed |
| Refund external-consumer pilot | 3/3 passed; simulated provider; real semantics `not_run` |
| Email external-consumer pilot | 3/3 passed; simulated provider; real semantics `not_run` |
| Core packed-package consumer | Passed |
| Analyzer packed-package consumer | Passed with injected transport and zero network calls |
| Generator/verifier packed-package consumer | Passed; real semantics `not_run` |
| Tarball inspection | Passed; 83 core files, explicit exports, public migrations only |
| License in supported tarballs | Present |
| Production dependency audit | No known vulnerabilities reported on the validation date |
| CycloneDX SBOM | Generated with 14 runtime dependency components |
| Current-source credential-shape scan | Passed |
| Reachable Git-history credential-shape scan | Passed across 12 reachable commits |
| Documentation path hygiene | Passed across 59 files |
| `protect-agent-actions` skill validator | Passed |
| Credential-free `pnpm evaluate:local` | Passed in 52.4 seconds during the full gate |
| PostgreSQL validation cleanup | Passed; validation containers and networks removed |

The evaluator again observed two unsafe simulated effects and one guarded simulated effect. Its static verification, generated tests, adapter conformance, and receipt policy passed with the documented limitations; real-provider semantics remained `not_run`.

## Issues found during preparation

The first OneDrive-hosted unit run received a transient Windows `EPERM` during the generator's final staged-directory rename. The publisher now retries only bounded `EPERM`, `EACCES`, and `EBUSY` errors on Windows, rechecks that the destination remains absent before each retry, and has deterministic regression coverage. The final full unit and PostgreSQL gates passed.

The existing local pilot gate assumes PostgreSQL is already running before its later sandbox-start step. For this run, the declared Compose service was started and checked for health before the gate, and both the manually started service and the gate-owned sandbox were stopped afterward. This ordering should be simplified in a follow-up maintenance change.

## Remaining release gates

1. Authenticate an owner-controlled GitHub session.
2. Review and commit this exact release diff.
3. Push the commit and wait for the Windows/Ubuntu evaluation and Ubuntu/PostgreSQL workflows.
4. Re-run the reachable-history scan against the remote branch.
5. Change repository visibility only after those remote checks pass.
6. Verify issue forms, private vulnerability reporting, license detection, and clone instructions from an unauthenticated browser.

No package was published and no provider or model credential was used during this preparation.
