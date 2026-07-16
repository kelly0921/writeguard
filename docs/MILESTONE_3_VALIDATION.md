# Milestone 3 Validation Report

Validation date: July 15, 2026.

Status: **ready for one focused sandbox design partner**.

This status does not mean production-ready, generally available, or provider-independent. It means another TypeScript developer can receive one package, install it, understand the supported boundary, run it in shadow mode, integrate a PostgreSQL-backed sandbox action, and evaluate it with a starter and conformance tests.

## Baseline preservation

Before Milestone 3 changes, `pnpm validate:milestone-2` passed:

- 18 unit tests;
- 12 PostgreSQL integration tests;
- 30 total tests;
- typecheck, build, and secret scan;
- unsafe 2 versus guarded 1 effect;
- MCP, support continuation, ten-caller concurrency, and child-process crash recovery.

The starting surface and demo-specific assumptions are recorded in `docs/MILESTONE_3_BASELINE.md`.

After Milestone 3:

- all original tests still pass;
- 22 unit tests pass across 8 files;
- 17 integration tests pass across 6 files;
- 39 total tests pass;
- typecheck, production build, migrations, and secret scan pass;
- the credential-free public demo reruns ordinary retry, MCP reconciliation, ten-caller concurrency, and process-crash recovery.

The prior real Stripe test-mode evidence remains valid. The Milestone 3 validation did not reuse or store the Stripe credential and did not create another real Stripe refund.

## Complete readiness command

`pnpm validate:design-partner` passed every gate and wrote a sanitized local report to `.writeguard/design-partner-readiness.json`.

| Gate | Result |
|---|---|
| Database migrations | Passed |
| Secret scan | Passed |
| Public package build and declarations | Passed |
| Typecheck | Passed |
| Production build | Passed |
| Unit, shadow, telemetry, and conformance tests | 22 passed |
| PostgreSQL, concurrency, crash, MCP, shadow, and starter tests | 17 passed |
| Clean tarball installation | Passed |
| Starter demo | Passed |
| Sanitized public demo | Passed |

The generated report measured 138.98 seconds inside the validation runner. The outer package command completed in 143.5 seconds.

## Package installation result

Package:

```text
@closure/writeguard@0.3.0
closure-writeguard-0.3.0.tgz
```

`pnpm package:verify`:

1. built JavaScript, source maps, declarations, and declaration maps;
2. copied only public WriteGuard migrations;
3. packed a tarball without publishing it;
4. created a fresh project in the operating-system temp directory;
5. installed the tarball and public dependencies;
6. typechecked a TypeScript consumer;
7. ran an acknowledgement-loss action;
8. reconciled to `CONFIRMED` with one external effect.

Result:

```json
{
  "cleanInstall": "passed",
  "typeDeclarations": "passed",
  "guardedAction": "passed",
  "externalEffects": 1
}
```

Explicit package exports are limited to `@closure/writeguard` and `@closure/writeguard/testing`. Internal compiled files are carried inside the tarball so it is self-contained, but Node package exports block them as public subpaths.

## Supported runtime API

The public root exports:

```text
createWriteGuard
WriteGuardClient
createPostgresStorage
migratePostgresStorage
createUnsafeInMemoryStorage
createLocalPilotTelemetry
PilotTelemetry
isUnknownExecutionOutcome
WriteGuardError
IllegalStateTransitionError
OperationKeyConflictError
OperationInProgressError
PreSubmissionFailure
ConfirmedExecutionFailure
UnknownExecutionOutcome
ReconciliationFailure
VerificationFailure
```

Supported types cover execution and reconciliation contexts, action/effect types, receipts, shadow observations, guarded tools, telemetry, and error codes.

`@closure/writeguard/testing` exports:

```text
adapterContractScenarios
defineAdapterContractTests
ConfirmedExecutionFailure
```

No public export exposes state-machine transition helpers, SQL row mappings, the fake provider, support-case schema, or unrestricted core modules.

## Storage boundary

External callers receive an opaque `WriteGuardStorage` handle and do not call internal table methods. The supported durable adapter is PostgreSQL. `migratePostgresStorage` installs operations, attempts, ordered events, receipts, shadow observations, and redacted shadow invocation records.

The public package deliberately excludes:

- the design-partner support-case tables;
- the original support-refund example tables;
- the internal fake-provider table.

`createUnsafeInMemoryStorage` is intentionally named and documented as unsafe for production because it loses all coordination on process exit.

## Shadow-mode behavior

`writeGuard.observe()`:

- derives and persists the stable operation identity and fingerprint;
- stores redacted, reported framework invocation traces;
- increments repeated-invocation counts;
- optionally performs provider reconciliation and verification;
- returns `mode: "shadow"` and `observational: true`;
- reports `wouldSuppressDuplicate` as a counterfactual identity result.

It has no execute hook, never acquires an enforcement claim, never creates an execution attempt, never calls the external write, and never suppresses the application's current invocation.

Unit and PostgreSQL tests verified:

- `call_A` and `call_B` produce one shadow identity with invocation count 2;
- provider reads can classify verified, ambiguous, unavailable, and no-match state;
- sensitive invocation metadata is redacted;
- provider evidence payloads are not stored;
- the enforcement operation table remains empty for the shadow namespace.

Shadow mode cannot prove whether uncontrolled application code executed or skipped a write unless the provider lookup supplies that evidence.

## Pilot telemetry

Optional telemetry emits only:

```text
metric name
timestamp
optional durationMs
```

It aggregates guarded operations, observed operations, duplicate invocations, unknown outcomes, successful and ambiguous reconciliations, review outcomes, suppressed executions, execution/reconciliation latency, and storage errors.

Tests inspected every JSONL record and confirmed it had no field beyond `name`, `recordedAt`, and optional `durationMs`. Customer messages, card fields, provider payloads, credentials, and unrestricted metadata cannot be attached through the telemetry interface.

`pnpm writeguard:report` prints a local period summary. There is no hosted collector or distributed aggregation service.

## Starter-application result

The separate `apps/design-partner-starter` package imports only `@closure/writeguard` for WriteGuard behavior. It owns its support and manual-comparison tables.

Observed demo:

| Path | Invocations | External effects | Result |
|---|---:|---:|---|
| Unsafe | 2 | 2 | duplicate effect |
| Manual ledger | 2 | 1 | reconciled `CONFIRMED` |
| WriteGuard | 2 | 1 | verified receipt and resolved support case |

The WriteGuard path used `call_A` and `call_B`, one stable key, one provider effect, `UNKNOWN`, reconciliation, `duplicateExecutionPrevented=true`, and `RESOLVED/CONFIRMED` application state.

The starter also exposes a real MCP tool in shadow and enforced modes and has four PostgreSQL integration tests.

## Adapter conformance

`defineAdapterContractTests` is framework-neutral and ran six required scenarios successfully:

- success;
- confirmed failure;
- timeout after external success;
- duplicate invocation;
- reconciliation unavailable;
- ambiguous matches.

The authoring requirements and cardinality rules are in `docs/ADAPTER_AUTHORING.md`.

## Adoption measurements

Measured in the starter:

| Implementation | Measured application code |
|---|---:|
| Unsafe | 12 lines |
| Manual reliability function | 63 lines plus 15 SQL lines |
| WriteGuard action contract | 40 lines |
| WriteGuard support continuation | 30 lines |

The first WriteGuard action is similar in application line count to the simplified manual example. The abstraction's leverage is the behavior the manual example still does not implement: fingerprints, transactional claims, leases, ordered history, durable receipts, compensation routing, concurrent waiting, and process-crash recovery.

This weakens any claim that WriteGuard is automatically simpler for one low-volume action. It strengthens the case for teams with multiple actions or missing reliability machinery.

## Remaining friction and provider limits

- Stable business keys and fingerprints remain application-designed and can be wrong.
- Provider reconciliation and verification remain meaningful action-specific code.
- PostgreSQL migrations and connectivity are required for durable enforcement.
- Long-running calls use leases but not active heartbeat renewal.
- Application continuation is not atomic with the receipt.
- Provider lookup consistency, retention, pagination, and rate limits bound recovery quality.
- Stripe refund lookup is bounded by PaymentIntent and client-side metadata filtering.
- Local telemetry is per file/process configuration, not a cross-service analytics product.
- Only Stripe test mode is externally validated; the second provider is a deterministic fake.
- No external developer has yet measured elapsed integration time or net code removal.

## Partner-ready and unsuitable workflows

Partner-ready:

- sandbox partial refunds;
- payout or provisioning actions with stable keys and provider lookup;
- order, ticket, shipment, or deployment creation with queryable status;
- agent tools whose framework call identity changes during resume or retry.

Not ready:

- first-use production money movement;
- providers with no idempotency or reconciliation surface;
- workflows requiring universal rollback;
- actions without a correct stable business identity;
- teams expecting hosted control plane, RBAC, or automatic provider semantics.

## Strongest next pilot

Integrate one existing TypeScript customer-support agent that issues Stripe test-mode partial refunds and already uses PostgreSQL. Use the team's actual order/refund key and current retry path. Run shadow mode for one week, measure regenerated call IDs and provider reconciliation quality, then enforce only sandbox refunds.

This is the strongest recommendation because it matches the founder-run Stripe test-service validation already completed. It does not represent validation by an outside team. The pilot would directly test the unresolved product question: whether WriteGuard replaces meaningful code and recovery work for another team faster than that team can maintain its own reliability ledger.
