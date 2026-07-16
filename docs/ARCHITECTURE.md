# Architecture

Status: research MVP, July 14, 2026.

## Design target

WriteGuard guards one consequential external action. It is deliberately smaller than a durable workflow runtime: the caller supplies `execute`, `reconcile`, `verify`, and optionally `compensate`; WriteGuard supplies operation identity, durable coordination, failure-state semantics, and a receipt.

## Components

```text
agent / application / workflow runtime
                 |
                 v
          @writeguard/sdk
          claim -> execute
             |      |
             |      v
             |   provider adapter --------> external provider
             |      ^                           |
             |      | reconcile + verify        |
             v      |                           |
      @writeguard/core <-------------------------+
       PostgreSQL ledger
       events + attempts + receipt
```

- `@writeguard/sdk` controls the lifecycle and never retries an uncertain write directly.
- `@writeguard/core` defines the state machine, typed errors, stores, redaction, fingerprinting, and fake provider.
- `@writeguard/stripe-adapter` implements one action contract: create, find, and verify a Stripe refund.
- PostgreSQL is the coordination authority. The fake provider commits to a separate table so its effect is not accidentally atomic with the ledger.

### Public package boundary

`@closure/writeguard` is the supported external facade. It exposes factories, the client, supported types and errors, PostgreSQL migrations, local telemetry, and the adapter conformance kit. It does not export internal state-transition functions, database rows, the fake provider, or example schemas.

The package compiles the validated internal core into one installable tarball. Explicit package exports limit consumers to `@closure/writeguard` and `@closure/writeguard/testing`.

### Shadow ledger

Shadow observations use separate `writeguard_shadow_observations` and `writeguard_shadow_invocations` tables. They do not enter `PLANNED`, acquire an enforcement lease, create an execution attempt, or produce an enforcement receipt. This separation is the structural guarantee that observation cannot become execution through a state-machine accident.

### Pilot telemetry

Telemetry is an optional sink outside the correctness path. The SDK emits a closed vocabulary of metric names with optional duration. The local implementation appends timestamped JSONL records. Telemetry write failure is swallowed so analytics cannot decide whether an external write runs; configured storage failures remain application-visible and increment a best-effort storage-error metric when the telemetry sink is still available.

## State machine

```text
PLANNED -> CLAIMED -> SUBMITTED -> CONFIRMED
                         |  \----> FAILED
                         |  \----> COMPENSATING -> COMPENSATED
                         |                         \-> NEEDS_REVIEW
                         v
                      UNKNOWN -> RECONCILING -> CONFIRMED
                                      |  \----> FAILED
                                      |  \----> COMPENSATING
                                      |  \----> NEEDS_REVIEW
                                      \--------> UNKNOWN
```

Terminal states are `CONFIRMED`, `FAILED`, `COMPENSATED`, and `NEEDS_REVIEW`. `UNKNOWN` is intentionally nonterminal. Every meaningful state change is written to `writeguard_operation_events`; a monotonic `event_sequence` gives deterministic timeline order.

## Execution lifecycle

1. Validate the small action envelope with Zod.
2. Redact configured and recognized secret metadata.
3. Hash the action descriptor plus material input into a request fingerprint.
4. Atomically insert or select `(namespace, operation_key)`.
5. Reject the key if its fingerprint differs from the first call.
6. Persist `SUBMITTED` and an execution attempt before calling the provider.
7. Classify the result:
   - explicit pre-submission/provider rejection -> `FAILED` receipt;
   - confirmed result -> verify, then `CONFIRMED`, compensate, or review;
   - possibly submitted result -> `UNKNOWN`, release the claim, and throw a typed error.
8. A later call with the same key moves `UNKNOWN -> RECONCILING` and invokes the provider-specific lookup.
9. One verified match becomes `CONFIRMED`; no match or multiple matches becomes `NEEDS_REVIEW`; a temporarily unavailable lookup returns to `UNKNOWN`.
10. A terminal receipt is returned unchanged to all later same-key calls.

## Concurrency model

The database enforces `UNIQUE(namespace, operation_key)`. Claiming runs in a transaction:

```sql
INSERT ... ON CONFLICT DO NOTHING;
SELECT * FROM writeguard_operations
WHERE namespace = $1 AND operation_key = $2
FOR UPDATE;
```

The row lock serializes decisions across processes. An active lease produces `in_progress`; the SDK polls until it receives the terminal receipt or its local wait timeout expires. It does not call the provider while another live owner holds the operation.

Lease recovery depends on the durable boundary:

- Stale `CLAIMED`: the provider was not yet marked submitted, so another worker can reclaim and execute.
- Stale `SUBMITTED`: the request may have crossed the provider boundary, so it becomes `UNKNOWN` and must reconcile.
- Stale `RECONCILING`: the lookup outcome is unknown, so it returns to `UNKNOWN` for another reconciliation attempt.

This model prefers duplicate prevention over automatic liveness. If a provider cannot establish absence reliably, WriteGuard escalates instead of guessing.

## Database design

- `writeguard_operations`: identity, fingerprint, current state, lease, minimal redacted metadata, and lifecycle timestamps.
- `writeguard_operation_attempts`: execution/reconciliation attempts, outcome, sanitized error, and provider reference.
- `writeguard_operation_events`: append-only ordered transition history.
- `writeguard_execution_receipts`: one terminal receipt per operation.
- `fake_provider_refunds`: independent external-system test double; deliberately has no operation-id uniqueness so blind retry can duplicate.

The Drizzle schema documents these objects. The store uses explicit parameterized SQL for the transactional claim path so lock scope and transition order remain auditable.

Milestone 2 also records one redacted `INVOCATION_RECEIVED` same-state event for each framework tool invocation. This preserves `call_A` / `call_B` trace evidence without adding either identifier to the operation key or fingerprint. The example-only `support_cases` table remains application-owned and is not part of WriteGuard's transaction boundary.

## Crash windows

- Crash before `SUBMITTED`: safe stale-claim reclaim.
- Crash after `SUBMITTED` but before provider call: reconciliation may find nothing; the conservative result is review, not blind retry.
- Provider commits and response is lost: persisted `SUBMITTED` becomes `UNKNOWN`; reconciliation finds the effect.
- Provider returns success but local persistence fails: lease expiry follows the same `UNKNOWN` path.
- Verification fails after a known effect: compensate when supplied, otherwise review.

The unavoidable false-positive ambiguity in the second case is why the SDK does not promise universal exactly-once effects.

## Trust boundaries and stored data

- The application controls operation keys, material fingerprints, metadata, and all provider hooks.
- PostgreSQL is trusted for uniqueness, locks, durable ordering, and terminal receipts.
- Providers are authoritative about their own external objects but may expose eventual or incomplete reads.
- Reconciliation evidence is untrusted application data until `verify` accepts the intended postcondition.

Persisted data should be identifiers, hashes, provider references, timestamps, sanitized errors, and minimal evidence. Built-in secret-name matching and configured nested paths redact metadata; Stripe/card payloads are not stored. SQL values are parameterized. No dynamic code execution is used.

## Compatibility

A Temporal activity, Restate handler, DBOS step, LangGraph task, MCP tool implementation, or ordinary API handler can call `WriteGuard.execute`. The outer runtime still owns scheduling and durable control flow; WriteGuard owns the semantic boundary around one external write.
