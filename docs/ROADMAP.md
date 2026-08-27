# Roadmap

## MVP: implemented

- Small framework-neutral TypeScript API
- Explicit operation state machine and typed failure classes
- PostgreSQL uniqueness, row locking, leases, attempts, ordered events, and receipts
- In-memory store for unit tests
- Deterministic fake refund provider and lost-acknowledgement fault
- Cross-worker concurrency and stale-claim tests
- Stripe test-mode refund adapter
- CLI ordinary-retry comparison and operation timeline
- Minimal metadata persistence, fingerprints, and secret redaction

The MVP is successful as a local technical proof. It is not yet validated as a product or production library.

## Next validation version

1. Run the Stripe path with a supplied test credential and record the exact API evidence and time-to-integrate.
2. Extract a versioned `RefundActionContract` that defines operation identity, reconciliation consistency window, verification evidence, and compensation semantics.
3. Add lease heartbeats/cancellation for slow provider calls and a deterministic process-kill/database-outage harness.
4. Exercise the library inside one durable runtime and one agent runtime to prove composability rather than building integrations for every framework.
5. Add a second action with different semantics, such as CRM record creation or calendar booking, to test whether the contract generalizes.
6. Test with 3–5 design partners and measure guarded-action code, integration time, ambiguous outcomes found, false review escalations, and duplicate effects prevented.
7. Define a manual review runbook and safe operator actions before adding a UI.

## Future platform possibilities, conditional on evidence

- Provider-published action contracts and conformance tests
- Self-hosted worker/service for shared coordination across languages
- Hosted receipt and reconciliation control plane
- Retention policies, customer-managed encryption keys, and metadata-only modes
- Policy-driven review queues and alerts
- Additional language SDKs and adapter registry
- Workflow-level effect graph and compensation planning

These become credible only if multiple teams need shared operation identity and reconciliation across runtimes.

## Explicitly deferred

- Agent framework, workflow engine, scheduler, or prompt/model platform
- Generic trace/observability product
- Dashboard polish
- Enterprise identity and authorization
- Universal compensation or rollback claims
- Universal exactly-once delivery claims
- Broad adapter catalog before the action-contract thesis is tested

## Recommended next build

Iteration 7 is **Independent Real-Provider Adoption**, not a broader platform:

1. Complete the Apache-2.0 public-beta release audit and expose the clean WriteGuard-only repository.
2. Keep the SDK and CLI as the product; use the optional agent skill only to guide integration.
3. Observe two unassisted external developers using `pnpm evaluate:local`; record confusion, trust, limitations comprehension, and honestly classified time.
4. Have at least one developer protect a real provider test-mode action with its own stable business identity, reconciliation, verification, and rollback ownership.
5. Apply the public six-scenario conformance receipt only where the provider supports each scenario and preserve unsupported results explicitly.
6. Fix the repeated integration friction found in that evidence before adding packages, adapters, or UI.

The key validation remains whether an independent developer can supply reliable identity, reconciliation, and verification with materially less bespoke failure-handling code. Success is one understandable, receipt-backed test-mode integration—not package-download counts or a faster maintainer demo.
