# Design-Partner Guide

## Ideal partner

The best first partner has a TypeScript service or agent that already initiates external writes, uses PostgreSQL, can run a sandbox workflow, and has felt retry ambiguity or manual recovery pain. The team should be able to identify one stable business intention and query its provider for prior effects.

Strong signals:

- multiple workers or resumable agent runs;
- framework tool-call IDs can change during replay;
- duplicate or uncertain actions have meaningful cost;
- support or operations staff already reconcile provider state manually;
- one workflow can be isolated in test mode.

## Suitable pilot workflows

- partial refunds in Stripe test mode;
- payment or payout initiation with a provider lookup;
- account provisioning or entitlement grants;
- ticket, shipment, or order creation;
- deployment or infrastructure mutations with status lookup;
- outbound messages only when the provider exposes a durable message record.

## Unsuitable workflows

- actions with no stable business key;
- providers with no usable idempotency or reconciliation surface;
- hard real-time paths that cannot tolerate PostgreSQL or reconciliation latency;
- high-risk production money movement as the first test;
- workflows requiring automatic rollback guarantees;
- writes also performed through uncontrolled paths that cannot be observed;
- teams unwilling to own postcondition verification.

## Deployment options

The supported pilot deployment is application-local:

- install `@closure/writeguard` in the existing TypeScript service;
- use the team's PostgreSQL database or an isolated pilot database;
- run packaged forward-only migrations;
- keep telemetry in a local JSONL file or disable it;
- keep provider credentials in the team's existing secret manager.

There is no WriteGuard cloud service, hosted control plane, authentication layer, or external telemetry collector.

## Data stored

- namespace and stable operation key;
- action name, provider label, and effect type;
- SHA-256 request fingerprint;
- redacted, application-selected metadata;
- claim owner and lease timestamps;
- attempts, classifications, safe error categories, and provider references;
- ordered events and terminal receipts;
- shadow invocation count and redacted invocation trace;
- optional local aggregate metric events with timestamps and durations.

## Data not stored

- complete tool arguments;
- customer messages or email bodies;
- card, bank, or payment-method data;
- secrets, tokens, cookies, or authorization headers;
- unrestricted provider responses;
- model prompts or completions;
- customer identities unless the partner deliberately chooses a non-sensitive identifier for the operation key.

## Pilot phases

### Phase 0: sandbox contract

Choose one workflow, define the stable key, implement provider reconciliation and verification, run the conformance kit, and reproduce an acknowledgement loss in provider test mode.

### Phase 1: shadow mode

Instrument reported invocations without moving the external write behind WriteGuard. Confirm key cardinality, duplicate invocation rate, reconciliation visibility, ambiguous-match rate, and redaction. Shadow never suppresses or initiates the write.

### Phase 2: enforced sandbox

Move only the sandbox write behind `execute`. Test ordinary retry, `UNKNOWN`, delayed reconciliation, concurrency, process termination, application continuation, and rollback to the prior code path.

### Phase 3: narrow non-production workflow

Run a bounded internal or non-production workload with on-call ownership and review procedures. Production expansion is a separate decision based on evidence.

## Success metrics

- one stable key maps repeated invocations correctly;
- zero duplicate external effects in guarded test scenarios;
- successful reconciliation rate for `UNKNOWN` outcomes;
- ambiguous and `NEEDS_REVIEW` rate is operationally acceptable;
- integration time and net application code delta;
- support recovery time compared with the current process;
- no sensitive data in tables, logs, or telemetry;
- rollback drill succeeds.

## Rollback procedure

1. Stop routing new writes through the guarded code path.
2. Leave the WriteGuard tables intact for investigation and outstanding reconciliation.
3. Resume the previous sandbox path only for new, distinct business-operation keys.
4. Reconcile every `SUBMITTED`, `UNKNOWN`, or `RECONCILING` operation before replaying it elsewhere.
5. Export only sanitized receipts and metric summaries needed for the pilot review.

Disabling WriteGuard does not prove that an already submitted provider action did not commit.

## Support expectations

The initial pilot is founder-supported and scoped to one TypeScript workflow, one provider adapter, PostgreSQL, and sandbox or non-production use. Expected support includes integration review, key design, adapter conformance, failure injection, and weekly evidence review. It does not include 24/7 production incident response or provider-specific operational guarantees.

## Known limitations

- no atomic transaction with the external provider and application database;
- PostgreSQL is the only durable adapter;
- provider lookup consistency and retention bound reconciliation quality;
- application keys and verification hooks can be wrong;
- shadow mode cannot see uncontrolled execution without provider evidence;
- local telemetry is per configured file and not a distributed metric system;
- no hosted dashboard, RBAC, organizations, or billing;
- one real provider, Stripe test mode, has been externally validated.

## Recommended first pilot

Use a TypeScript customer-support agent that issues Stripe test-mode partial refunds. Run one week in shadow mode using the team's actual order/refund identity, then enforce only sandbox refunds. This matches the strongest evidence in the repository and tests whether WriteGuard replaces real retry and recovery code instead of a hypothetical implementation.
