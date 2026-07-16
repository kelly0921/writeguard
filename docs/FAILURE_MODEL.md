# Failure Model

## The three outcomes

`CONFIRMED` means provider evidence and the application postcondition agree that the intended effect exists. `FAILED` means there is affirmative evidence the effect was not accepted or could not have been submitted. `UNKNOWN` means the effect may exist but the caller cannot currently prove either outcome.

Timeout is a transport observation, not an external-state verdict. Converting every timeout to `FAILED` is the unsafe step that causes duplicate refunds, bookings, emails, and records.

## Taxonomy and response

| Observation | Classification | Safe response |
|---|---|---|
| Validation/authentication fails before submission | Pre-submission failure | Persist `FAILED`; do not pretend provider success |
| Provider explicitly rejects the action | Confirmed execution failure | Persist `FAILED`; same-key calls return the receipt |
| Connection breaks after dispatch may have occurred | Unknown execution outcome | Persist `UNKNOWN`; reconcile before any retry |
| Provider returns an object and postcondition passes | Confirmed | Persist `CONFIRMED` receipt |
| Provider returns an object but verification fails | Known but invalid effect | Compensate if credible; otherwise `NEEDS_REVIEW` |
| Reconciliation finds exactly one matching effect | Candidate found | Independently verify; then confirm/compensate/review |
| Reconciliation finds no match | Absence not proven | `NEEDS_REVIEW` in this MVP |
| Reconciliation finds multiple matches | Ambiguous/duplicate effects | `NEEDS_REVIEW` with all references |
| Reconciliation API is unavailable or not yet consistent | Still unknown | Return to `UNKNOWN`; retry reconciliation later |
| Compensation fails | Unresolved effect | `NEEDS_REVIEW` |

## Duplicate execution

An operation key is an identity for intent, not merely a retry token. The first call stores a fingerprint of action plus material input. A later call using the key with different input fails with `OperationKeyConflictError`. Calls using the same key and fingerprint share one durable operation and terminal receipt.

Provider idempotency remains valuable but is not the sole safety layer. WriteGuard also records `SUBMITTED`, prevents a second live worker, searches provider state after ambiguity, and verifies the returned object. This matters when provider idempotency windows expire, integrations do not support keys, or the application's retry spans different runtimes.

## Partial completion

The MVP guards one external action. It does not make a multi-system workflow atomic. A sequence such as “refund, update CRM, send email” needs one guarded identity per effect plus workflow-level policy for ordering and compensation. A receipt can report unresolved effects, but it cannot roll back reality.

## Compensation limits

Compensation is a semantic action, not database rollback. Some actions are reversible (cancel a newly created reservation), some conditionally reversible (refund before settlement or revoke access before use), and some practically irreversible (email delivered, secrets disclosed, infrastructure destroyed). The hook runs only after a known result fails verification; success is recorded separately as `COMPENSATED`. Any uncertain or failed compensation escalates.

## Human review is a safety state

`NEEDS_REVIEW` is required when automatic evidence cannot justify another write or a terminal claim. Examples include multiple provider matches, a negative lookup on an eventually consistent API, an effect that fails verification without credible compensation, and compensation failure. It is not silently collapsed into success or failure.

## Assumptions

- PostgreSQL is reachable often enough to claim before provider execution.
- The provider offers some stable correlation field or query surface for reconciliation.
- The application chooses operation keys at the business-intent level.
- Verification can check more than “the SDK returned without throwing.”
- Clock skew is not used to decide ownership; lease timestamps are written by PostgreSQL.

If an action lacks stable identity, observable state, and a meaningful postcondition, WriteGuard can record uncertainty but cannot manufacture certainty.
