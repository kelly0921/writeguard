# Product Boundary

WriteGuard is a durable local execution-control layer for application- or agent-triggered external writes. Guarantees are scoped to operations that enter WriteGuard with a correct stable key, use a functioning durable store, and supply correct provider semantics.

## WriteGuard guarantees

Within that scope, WriteGuard provides:

- stable operation identity under one namespace and key;
- request-fingerprint conflict detection;
- durable local claims and leases;
- duplicate execution suppression for the same claimed operation;
- persistence of `SUBMITTED` before calling the provider;
- explicit `UNKNOWN` classification when commitment may have occurred;
- reconciliation orchestration before any later execution attempt;
- zero, one, multiple, and unavailable match handling;
- application-supplied postcondition verification;
- one terminal receipt per operation;
- ordered attempt and event history;
- stale-worker and process-crash recovery through leases and reconciliation;
- safe escalation to `NEEDS_REVIEW` when external state cannot be resolved;
- redaction of configured and common sensitive metadata fields.

These guarantees are local coordination and evidence guarantees. They are not a universal claim that the external world executed exactly once.

## WriteGuard does not guarantee

WriteGuard does not provide:

- an atomic transaction across an external provider and local databases;
- universal rollback or successful compensation;
- availability, completeness, or consistency of provider reconciliation;
- correctness of application-supplied business keys;
- correctness of application-supplied fingerprints, reconciliation, or verification;
- exactly-once network delivery;
- prevention or discovery of effects created outside WriteGuard;
- automatic resolution of ambiguous external state;
- a proof that zero visible matches means no submission occurred;
- closure of application-owned support cases or workflow state in the same transaction as a receipt;
- multi-region consensus beyond the configured PostgreSQL store;
- hosted telemetry, authentication, RBAC, billing, or a workflow engine.

## Shadow-mode boundary

Shadow mode:

- persists stable identity and redacted invocation traces;
- counts repeated invocations;
- may perform a configured provider read and verification;
- emits an explicitly observational receipt;
- estimates whether a repeated invocation would share one operation identity.

Shadow mode never:

- calls an execute hook;
- initiates an external write;
- suppresses the application's current invocation;
- proves that uncontrolled application code executed or skipped a write;
- converts an observation into an enforced operation.

`wouldSuppressDuplicate` is a counterfactual identity result, not a claim that an external duplicate was prevented.

## Meaning of duplicate prevention

`duplicateExecutionPrevented=true` means WriteGuard reached a prior terminal result or reconciled a previously submitted operation without calling the supplied execute hook again. It does not mean no other system, credential, operator, or code path created a similar provider effect.

## Provider and application responsibility

The provider adapter must define native idempotency, correlation, lookup cardinality, consistency windows, verification, retention, and reversibility. The application must define business identity, namespaces, continuation, review ownership, deployment, and rollback.

If those inputs are wrong, WriteGuard can durably enforce the wrong decision. The system fails closed on key/fingerprint conflicts and unresolved state, but it cannot infer business truth.
