# Integration Experience

Milestone 3 assessment, July 15, 2026. These measurements come from the design-partner starter in this repository. They are source measurements and observed local command times, not a controlled external-developer study.

## Same requirement, three implementations

Business intent: refund 100 minor currency units for Order 781. Framework calls `call_A` and `call_B` may represent one intent.

| Dimension | Unsafe | Manual starter | WriteGuard starter |
|---|---:|---:|---:|
| Application function / contract | 12 lines | 63 lines | 40-line action contract |
| Application continuation | none | included in function | 30 lines for support-case continuation |
| Application-owned SQL schema | none | 15 lines | 0 WriteGuard tables; migrations are packaged |
| External effects after lost acknowledgement and retry | 2 | 1 | 1 |
| Durable terminal receipt | No | No | Yes |
| Ordered attempt/event history | No | No | Yes |
| Lease and stale-process recovery | No | No | Yes |
| Ten-caller concurrency proof | No | No | Yes |
| Ambiguous-match escalation | No | simplified `NEEDS_REVIEW` | Yes, with unresolved references |

Line counts use `apps/design-partner-starter/src/workflow.ts`: unsafe lines 117-128, manual lines 130-192 plus its schema, action contract lines 201-240, and WriteGuard-owned support continuation lines 242-271.

The first WriteGuard integration is not dramatically shorter than the deliberately narrow manual example. Its value is replacing the deeper machinery the manual example still omits: fingerprints, transactional locks, leases, ordered events, durable receipts, compensation routing, concurrent waiting, stale-worker recovery, and classified errors. It would be dishonest to claim a large net line reduction from this starter alone.

## Clean package installation result

`pnpm package:verify` performed all of the following outside the workspace package graph:

1. built JavaScript and declarations;
2. created `closure-writeguard-0.3.0.tgz`;
3. copied a clean fixture with no workspace dependencies;
4. installed the tarball and its public dependencies;
5. typechecked a TypeScript consumer;
6. ran `UNKNOWN -> reconciliation -> CONFIRMED`;
7. asserted exactly one external effect.

The validated run took 17.2 seconds on this machine; dependency installation took 2.2 seconds with a warm local package store. This is not a cold-network installation benchmark.

## Required adoption steps

An enforced PostgreSQL integration requires five setup steps:

1. install `@closure/writeguard`;
2. run `migratePostgresStorage` during deployment;
3. create a PostgreSQL storage handle;
4. create a namespaced WriteGuard client;
5. supply the action contract and application continuation.

The developer must understand at least eight concepts:

- stable business-operation key;
- request fingerprint;
- effect type;
- execution versus reconciliation;
- zero, one, multiple, and unavailable reconciliation outcomes;
- postcondition verification;
- `UNKNOWN` as durable uncertainty;
- terminal receipt and application continuation.

Shadow mode removes the execute hook and critical-path control, but it still requires correct identity and an optional provider lookup to produce useful evidence.

## Provider-specific code

WriteGuard does not remove semantic provider work. For each action, the adopter still supplies:

- provider execution and native idempotency configuration;
- correlation metadata or a bounded lookup key;
- reconciliation query and consistency assumptions;
- result cardinality handling;
- postcondition verification;
- provider-reference extraction;
- reversibility and compensation policy.

The starter's provider-facing portion is about 20-30 lines after key construction. The Stripe adapter is larger because it verifies amount, currency, PaymentIntent, metadata, status, and prior refund capacity. Adapter reuse is therefore central to the product thesis.

## Database and deployment work

The public package owns forward-only migrations for:

- operations, attempts, events, and receipts;
- ordered event sequencing;
- shadow observations and redacted invocation records.

It does not install the starter's support tables or the internal fake-provider table. The adopter must run one migration helper in its deployment pipeline, provide PostgreSQL connectivity, keep clocks reasonably synchronized for leases, and close the pool on shutdown.

The in-memory adapter avoids setup but is explicitly unsafe for production because process exit loses every claim and observation.

## Testing work

The adopter should test its provider adapter, not the WriteGuard state machine from scratch. `@closure/writeguard/testing` covers six conformance scenarios:

- success;
- confirmed provider failure;
- timeout after provider success;
- duplicate invocation;
- reconciliation unavailable;
- ambiguous matches.

The starter adds four integration tests for support continuation, shadow behavior, a manual comparison, and an MCP boundary. The repository retains the ten-caller and child-process crash tests.

## What WriteGuard replaces

- unique operation rows and request-fingerprint conflicts;
- transactional claims and active/expired leases;
- `SUBMITTED` durability before the provider boundary;
- explicit `UNKNOWN` state;
- reconciliation gating instead of blind re-execution;
- zero/one/multiple/unavailable routing;
- verification and optional compensation orchestration;
- ordered attempts/events and one terminal receipt;
- concurrent waiting and stale-process recovery;
- metadata redaction and typed failure classes;
- privacy-constrained pilot metric hooks.

## What remains awkward

- The stable business key cannot be inferred safely. A wrong key can suppress distinct intentions or fail to group duplicates.
- `UNKNOWN` requires an explicit application and agent continuation policy.
- A receipt and an application-owned support-case update are not one distributed transaction.
- Shadow mode observes invocation identity, not whether uncontrolled application code truly ran, unless provider lookup supplies that evidence.
- Local telemetry counts events from the instrumented process; it is not a hosted, cross-service analytics system.
- PostgreSQL is the only supported durable storage adapter.
- The first action contract remains meaningful code, and a low-volume workflow may be simpler with provider idempotency plus a small manual ledger.

## Honest conclusion

WriteGuard is clearly easier than rebuilding the repository's full concurrency, crash, uncertainty, reconciliation, and receipt behavior inside one application. It is not clearly simpler than a narrow manual ledger for a single low-volume action. The adoption case becomes strong when a team has several agent-triggered writes, regenerated framework call IDs, expensive ambiguity, multiple workers, and a provider with usable reconciliation.

The next study must measure a real team's elapsed time and code delta. This repository can now support that study; it does not substitute for it.
