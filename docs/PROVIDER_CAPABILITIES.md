# Provider Capability Assessment

Assessment date: July 15, 2026. “Fake provider” refers to the deliberate test double in this repository, not a production payment API.

| Capability | Fake provider | Stripe refunds | Consequence for WriteGuard |
|---|---|---|---|
| Native idempotency | None by design; repeated creates can duplicate | Yes for POST requests when the same key and parameters are reused | Helpful but insufficient when the application derives a new key from each agent invocation |
| Client metadata | Operation ID stored on each fake refund | Refund metadata supports a client operation marker | Strong correlation primitive; never store sensitive data there |
| Direct lookup by metadata | Yes in the test contract | No refund-list filter for arbitrary metadata | Stripe adapter lists by associated PaymentIntent and scans metadata |
| Lookup by associated resource | PaymentIntent ID | Refund list accepts PaymentIntent | Bounds reconciliation better than account-wide search |
| Clear success state | `succeeded` | Refund status such as `succeeded` | Enables postcondition verification |
| Clear confirmed failure | Configurable explicit rejection | Stripe returns typed/API errors; refund objects can also fail | Adapter must distinguish explicit rejection from transport ambiguity |
| Ambiguous transport outcome | Deterministic scenario | Possible when the caller loses the response after dispatch | Must reconcile before another write |
| Independent verification | Operation ID, PaymentIntent, amount, currency, status | PaymentIntent, metadata marker, amount, currency, and status | Verification must check material fields, not only object existence |
| Reconciliation consistency | Immediate or deterministic delay | Provider-managed; list visibility and network availability must be assumed/documented | `unavailable` remains `UNKNOWN`; empty results are conservative |
| Reversibility | Not implemented | A completed refund is generally not meaningfully undoable | Refund actions should be classified as irreversible for this MVP |
| Compensation | No provider reverse action | No general “un-refund” operation | Human review and downstream business handling are more credible than automatic compensation |
| Retention affecting retries | Persists as long as the test database | Stripe documents idempotency-key pruning after at least 24 hours; refund objects persist under Stripe policy | WriteGuard's business identity may need longer retention than provider request keys |
| Multiple valid matches | Deliberately simulatable | Possible if different keys or manual actions create multiple refunds | Multiple operation-marker matches must become `NEEDS_REVIEW` |
| Evidence quality | Fully controlled test data | Real provider IDs/status/amount/currency/metadata | Stripe evidence is stronger externally, but only after a real test-mode run |

Sources: [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), [refund creation](https://docs.stripe.com/api/refunds/create?lang=nodejs), [refund list](https://docs.stripe.com/api/refunds/list?lang=node), and [metadata](https://docs.stripe.com/api/metadata?lang=nodejs), accessed July 15, 2026.

## Minimum adapter requirements

A useful provider/action adapter needs:

1. A way to carry or associate a stable operation marker, or another collision-resistant correlation strategy.
2. A bounded query surface for reconciling after an uncertain submission.
3. Explicit results for `found`, `not_found`, `ambiguous`, and `unavailable`.
4. A postcondition verifier using material business fields.
5. Documented native idempotency rules and retention.
6. Documented read consistency and pagination behavior.
7. An honest effect classification and compensation policy.

Native provider idempotency is desirable, not mandatory. Without it, the durable claim and reconcile-first rule carry more risk and the adapter's evidence quality becomes decisive.

## What cannot safely be standardized yet

- How a provider proves authoritative absence
- The consistency window before a negative lookup is meaningful
- Provider-specific search/pagination strategy
- The business meaning of success
- Whether multiple resources are duplicates or legitimate separate actions
- Reversibility and compensation semantics
- Retention required for business-operation keys

The generalized interface can standardize outcome shape and lifecycle. It should not conceal these provider differences behind a universal “exactly once” claim.
