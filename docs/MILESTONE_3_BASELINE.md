# Milestone 3 Baseline

Baseline captured on July 15, 2026 before Milestone 3 implementation.

## Validation starting state

`pnpm validate:milestone-2` completed successfully in 95.3 seconds against PostgreSQL 16.14 in Docker Compose.

| Check | Baseline result |
|---|---|
| Secret scan | Passed |
| TypeScript typecheck | Passed |
| Production build | Passed |
| Unit tests | 18 passed across 5 files |
| PostgreSQL integration tests | 12 passed across 4 files |
| Total tests | 30 passed |
| Ten-caller concurrency | One operation, one receipt, one external effect |
| Child-process crash recovery | Reconciled one committed effect after process exit |
| MCP agent tool | `call_A` and `call_B` mapped to one stable operation |
| Support-refund workflow | `OPEN/PENDING` became `RESOLVED/CONFIRMED` |
| Ordinary retry demo | Two invocations produced two fake refunds |
| Guarded retry demo | `UNKNOWN`, then reconciliation, one fake refund |
| Stripe test mode | Previously validated with two unsafe refunds and one guarded refund |

No existing behavior was skipped for this baseline. The integration command included the dedicated concurrency and child-process crash tests.

## Starting public surface

The repository had no externally installable package. The closest surface was the private workspace package `@writeguard/sdk` at version `0.1.0`, whose export pointed directly to `src/index.ts`.

It exposed:

- `new WriteGuard({ store, namespace, claimTtlMs, waitTimeoutMs, pollIntervalMs, workerIdFactory })`
- `WriteGuard.execute(options)`
- `WriteGuard.guardTool(options)`
- execution, reconciliation, verification, compensation, guarded-tool, and invocation context types
- `ConfirmedExecutionFailure`, `OperationInProgressError`, `PreSubmissionFailure`, `ReconciliationFailure`, `UnknownExecutionOutcome`, and `VerificationFailure`
- `ExecutionReceipt` and `ReconciliationOutcome`

The private `@writeguard/core` package exported all models, errors, security helpers, state-machine functions, storage internals, both storage implementations, fake-provider code, and database schema. That is useful inside the monorepo but is too broad to treat as a supported external API.

## Demo-specific assumptions found

- Core migrations `0002` and `0003` create and repair `support_cases`, even though support cases belong to the example application rather than WriteGuard storage.
- `fake_provider_refunds` lives in the initial core migration for deterministic failure testing.
- Apps import `@writeguard/core` and `@writeguard/sdk` workspace source directly.
- The SDK requires callers to construct an internal `OperationStore`; there is no application-level PostgreSQL storage factory or migration API.
- Package exports reference TypeScript source, so plain Node.js consumers cannot install and execute a tarball.
- Provider reconciliation, verification, and stable-key construction are intentionally application supplied.
- There was no shadow mode, local pilot telemetry, package conformance kit, clean consumer fixture, or semantic-versioning policy.

Milestone 3 keeps these internal packages for compatibility while adding a narrow packaged facade. Public migrations exclude the support-case tables; the starter application owns its own case schema.
