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

Iteration 6 should be external evaluation and one provider-specific test-mode conformance run, not a broader platform:

1. Resolve the owner-controlled license decision.
2. Push only after review and obtain actual Ubuntu/Windows CI evidence.
3. Observe at least one unassisted external developer using `pnpm evaluate:local`; record confusion, trust, limitations comprehension, and honestly classified time.
4. Use a freshly rotated test credential to apply the public six-scenario conformance receipt to one real provider adapter where the provider supports each scenario.
5. Refine docs/contracts only from that evidence; do not add a dashboard, hosted control plane, adapter catalog, or production claim.

The key validation remains whether a developer can supply reliable identity, reconciliation, and verification with materially less bespoke failure-handling code.
