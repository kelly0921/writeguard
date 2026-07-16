# Founder Findings

These findings come from the implemented refund proof and should be treated as hypotheses to validate with real integrations.

## How much action-specific code is required?

The generic call stays small, but a credible guarded action still needs four business decisions: operation key, material fingerprint, reconciliation query, and verification predicate. The refund demo is roughly a few dozen lines at the call site; the Stripe adapter removes repeated SDK mechanics but cannot choose business identity for the developer.

Evidence to collect next: time a new developer adding the first and second guarded action, and compare it with their existing idempotency/retry code.

## Can reconciliation be generalized?

Cardinality and lifecycle can be generalized: `found`, `not_found`, `ambiguous`, `unavailable`, followed by verification. The lookup itself is provider/action-specific. Stripe refunds can be correlated through PaymentIntent plus metadata; an email provider, calendar, CRM, or infrastructure API will expose different query surfaces and consistency behavior.

The promising reusable artifact is an action contract, not one universal reconciliation algorithm.

## Can MCP effect contracts be standardized?

MCP annotations can describe `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`, but the specification treats annotations as hints and clients must not trust them as enforcement. A WriteGuard contract would need stronger runtime fields: intent-key recipe, material-input schema, submission marker, reconciliation function, verification rule, and effect/compensation semantics. MCP could carry or reference that contract, but current annotations do not provide it.

## Does the abstraction reduce application code?

It centralizes the hard generic pieces: transactional claims, leases, state transitions, deduplication, attempts, events, typed uncertainty, receipt generation, redaction, and concurrent waiting. It does not eliminate the provider-specific code that creates trustworthy evidence. That division is a feature if action adapters can be reused; it is overhead if every action remains unique.

## Is it compatible with durable runtimes?

Yes at the API boundary. A Temporal activity, Restate handler, DBOS step, or LangGraph task can wrap one call. Those runtimes can replay or retry application work; WriteGuard protects the external semantic effect. Integration still needs care around runtime cancellation, database connectivity, and each system's own retry timeout.

## Is a library sufficient?

A library plus customer PostgreSQL is sufficient for this proof and for one TypeScript estate. A service becomes useful when multiple languages/runtimes must share identities, when reconciliation must continue after the application is gone, or when review/retention/authorization must be operated centrally. Building the service before those pains are observed would be premature.

## Which actions are easiest to verify?

Easiest: provider objects with stable IDs, searchable metadata, readable terminal status, and a business invariant—refunds, orders, CRM records, reservations, and access grants in systems with strong query APIs.

Hardest: delivered email/messages, irreversible disclosures, external systems without correlation fields, eventually consistent search with no bounded window, and actions whose real-world outcome differs from provider acceptance.

## When is compensation realistic?

It is realistic when the provider exposes a distinct reverse operation and the relevant invariant can be checked afterward. It is conditional when time, settlement, consumption, or downstream observers change reversibility. It is not realistic for many communicative or destructive effects. The receipt must distinguish “original action confirmed” from “compensation confirmed.”

## Which failures require a human?

- Multiple matching external effects
- Negative lookup where absence is not authoritative
- Failed or ambiguous compensation
- Known effect that fails verification and lacks safe compensation
- Provider evidence that conflicts with local intent
- Missing stable correlation after a possible submission

## Could providers publish contracts?

Possibly. A provider-authored contract could specify the idempotency-key policy, correlation fields, lookup pagination/consistency, terminal statuses, verification evidence, and supported compensation. The main risk is treating a syntactic adapter as semantic truth. Contracts need conformance tests and explicit uncertainty behavior.

## Current founder-level conclusion

The proof validates the mechanism, not yet the market. Stable identity plus durable `UNKNOWN` reconciliation works and materially changes the retry outcome in the fake/live-PostgreSQL demonstration. The remaining question is whether enough consequential actions expose reliable reconciliation surfaces—and whether developers will adopt a deliberate action contract instead of continuing with bespoke retries.

The next validation should be one credentialed Stripe run plus one real application integration, followed by a second provider with meaningfully different semantics. Avoid expanding into a workflow engine or dashboard until that evidence exists.
