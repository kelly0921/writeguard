# WriteGuard Milestone 4 Validation

Date: July 15, 2026

Status: **Locally ready for external pilot operations. External pilot results: 0. Production certified: no.**

## Baseline before changes

The complete Milestone 3 gate passed before Milestone 4 implementation in 84.2 seconds: migrations 0000–0005, secret scan, package declarations/build, typecheck, production build, 22 unit tests, 17 PostgreSQL/MCP/concurrency/crash/shadow/starter integration tests, clean tarball installation, starter demo, and credential-free public demo. `@closure/writeguard@0.3.0` installed into a clean consumer and returned one verified effect after UNKNOWN reconciliation.

The toolchain baseline was Node 24.17.0, pnpm 11.7.0, TypeScript 5.9.3, Vitest 3.2.7, and PostgreSQL 16.14. The repository had no commits or tags and every project file was untracked. `.tmp/` and `.writeguard/` were ignored.

## Core and package result

The public SDK remains frozen at `@closure/writeguard@0.3.0`. No state-machine, operation-identity, PostgreSQL ledger, migration, error, receipt, reconciliation, or public-export behavior changed. The packed artifact contains 50 files, declarations for `.` and `./testing`, README/changelog, and only migrations 0000, 0001, and 0004. Clean installation and execution still pass.

One dependency-only freeze exception was required. The first production audit found the high-severity Drizzle ORM advisory GHSA-gpj5-g38j-94v9. The private core manifest was raised from `^0.44.0` to patched `^0.45.2`; Drizzle is used for schema definition and is not in the published package runtime graph. The follow-up audit reported no known vulnerabilities, and the complete state-machine/integration/package gate passed.

## Files added or changed

- Pilot runtime: `apps/pilot-sandbox/` with validated config, fake and Stripe-test runners, starter workflow, deterministic state reset, aggregate export/report, doctor, and CLI.
- Sandbox: `.env.pilot.example`, `docker-compose.pilot.yml`, `scripts/pilot-control.mjs`, and root `pilot:*` commands.
- Public examples: `examples/pilot-shadow.ts` and `examples/pilot-enforced-refund.ts`; both import only `@closure/writeguard` public exports.
- Verification: pilot config/export/integration tests, tarball inspection, export schema verifier, CycloneDX generator, and `validate:pilot-ready` / `validate:pilot-ci`.
- CI: `.github/workflows/ci.yml` with frozen lockfile, PostgreSQL 16 service, and no Stripe credentials.
- Operations: scope, release checklist, quickstart, runbook, rollback, compatibility, support, dependency review, success criteria, UI triggers, decision-report template, feedback templates, issue templates, and `SECURITY.md`.
- Repository wiring: root scripts/test list, TypeScript example inclusion, ignored `.env.pilot`, README, workspace lockfile, and patched Drizzle constraint.

## CI behavior

The workflow uses Node 24, pnpm 11.7.0, `pnpm install --frozen-lockfile`, a healthy PostgreSQL 16 service, and `pnpm validate:pilot-ci`. That gate runs migration checks, secret scan, declarations/typecheck/build, all unit tests, PostgreSQL integration, MCP, concurrency, crash recovery, shadow and starter flows, clean tarball consumer install, public demos, tarball inspection, SBOM, advisory audit, both pilot modes, export redaction, doctor, and aggregate report generation. No Stripe key or network write credential is present.

The equivalent local readiness gate passed, and the exact `validate:pilot-ci` branch also passed locally against the PostgreSQL service path in 92.6 seconds. The GitHub-hosted workflow itself is not claimed as run until the repository is committed, pushed, and Actions completes.

## Pilot commands

```powershell
pnpm pilot:start
pnpm pilot:validate
pnpm writeguard:doctor
pnpm pilot:report
pnpm pilot:export
pnpm pilot:reset
pnpm pilot:stop
pnpm validate:pilot-ready
```

`pilot:start` creates an ignored safe-default config if needed and exposes PostgreSQL only on `127.0.0.1:54328`. Its Compose project is isolated from the baseline database. `pilot:reset` truncates the configured local pilot tables and removes pilot telemetry/report/export artifacts. `pilot:stop` removes the isolated container/network and retains its named volume.

## Sandbox workflow evidence

Shadow mode ran two uncontrolled fake-provider retries. Result: two provider effects, one observed business operation, one duplicate invocation, two ambiguous reconciliations, zero suppressed executions, zero storage errors, and an unchanged open support case. WriteGuard did not execute or suppress the write.

Enforced mode deliberately lost the first provider acknowledgement. Result: one provider effect, one UNKNOWN outcome, one successful reconciliation, one suppressed execution, a verified `CONFIRMED` receipt, a resolved support case, zero ambiguous reconciliations, zero `NEEDS_REVIEW`, and zero storage errors.

The complete gate passed 26 unit tests and 20 live-PostgreSQL/MCP/concurrency/pilot integration tests: 46 unique automated tests. It also reran the clean package consumer, starter, public demo, and a second focused concurrency/crash proof.

## Telemetry and export

Local telemetry records only a fixed metric name, timestamp, and optional duration. Telemetry failure cannot control an external write. The sanitized export contains SDK version, configuration categories, a namespace hash, observation period, aggregate counts, and average execution/reconciliation latency. It excludes raw operation/receipt/provider identifiers, operation keys, provider bodies, payment details, customer identifiers, full tool input/output, credentials, database URLs, and raw rows. No upload path exists.

The final enforced export recorded one guarded operation, one duplicate invocation, one UNKNOWN, one successful reconciliation, one suppressed execution, zero ambiguous results/review/storage errors, 22 ms average execution latency, and 1 ms average reconciliation latency. These are synthetic local sandbox measurements, not external pilot evidence.

## Doctor coverage

All 14 checks passed: Node runtime, SDK package/version, validated configuration, mode behavior, live Stripe rejection, fake-provider connectivity, adapter configuration, PostgreSQL connectivity, migration state, required tables, storage initialization, UNKNOWN classification, verified receipt creation, and reconciliation without duplicate execution. Messages are actionable and sanitize credential/database-URL patterns.

## Security, privacy, and supply chain

- Final repository secret scan passed. `.env.pilot` is ignored and safe by default; live Stripe keys are rejected.
- `pnpm audit --prod` reported no known vulnerabilities after the Drizzle patch.
- CycloneDX 1.5 SBOM generation found 14 reachable runtime dependency components for the public package, with no `NOASSERTION` license entries in the generated artifact.
- Tarball inspection rejects source/tests/environment files, workspace internals, and non-public migrations.
- SECURITY and issue templates redirect sensitive reports and prohibit raw credentials/identifiers/payloads.
- Receipt retention is a validated policy setting only; automated deletion is intentionally not claimed.

## Measured onboarding time

On the founder-operated local machine with dependencies and Docker image already available, the final gate measured 6.65 seconds for sandbox start/schema, 2.94 seconds for shadow validation, and 3.10 seconds for doctor. That is about 12.7 seconds from sandbox start through a shadow/doctor check, excluding package installation and human reading. This is not an external onboarding measurement. The pilot target remains at most 60 minutes of partner hands-on time to the first valid shadow observation.

## Known risks and limitations

- No independent external team has installed, maintained, or validated the integration.
- GitHub Actions has not run remotely because the repository has no first commit or push.
- PostgreSQL 16, ESM, and the recorded Node/toolchain are the only validated compatibility baseline.
- Stripe test mode is optional, credential-gated, excluded from CI, and was not rerun for Milestone 4.
- Operation-key design, provider reconciliation uniqueness, and verification correctness remain application responsibilities.
- Negative or unavailable provider lookup remains unsafe; it must not trigger blind re-execution.
- No automatic retention, hosted monitoring, alerting, authentication, RBAC, control plane, or production incident service exists.
- The local Docker volume is retained on stop; operators must run reset only after all uncertain operations are resolved.

## Required human actions

1. Decide whether to recover and tag a true Milestone 3 snapshot or make the first commit a combined baseline; follow `RELEASE_CHECKLIST.md` without mislabeling history.
2. Review every staged file, commit, push, and confirm the GitHub Actions run. No git or publication action was performed here.
3. Rotate any previously shared Stripe test credential before optional use; never provide it in chat or commit it.
4. Confirm private vulnerability-reporting availability and review SBOM/license obligations.
5. Recruit one narrow design partner, agree on data handling/retention/rollback ownership, and begin in shadow mode.
6. Record actual integration time, support burden, denominators, incidents, and partner sentiment using the feedback templates.
7. Inspect every `pilot:export` locally and obtain partner approval before sharing it.

## What would materially weaken the thesis

The thesis weakens if two serious pilots do not encounter or value duplicate/UNKNOWN-outcome protection; median time to first shadow observation remains above four hours after documentation fixes; provider reconciliation cannot uniquely identify effects; more than 10% of guarded operations require manual review; any WriteGuard-controlled retry creates a duplicate effect; storage/fail-closed behavior reduces reliability; or teams will not maintain the integration without founder operation. Demand centered on a generic workflow engine or dashboard rather than transactional reliability would also require a product reframe.

## Final gate

`pnpm validate:pilot-ready` completed successfully in 132.5 seconds. The exact CI-mode command then completed successfully in 92.6 seconds. Every listed check passed, local sandbox cleanup passed, `externalPilotResults` remained 0, and `productionCertified` remained false. Generated reports are under ignored `.writeguard/` for local inspection.
