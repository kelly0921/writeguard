# Milestone 2 Validation Report

Validation date: July 15, 2026.

## Environment

| Component | Version / mode |
|---|---|
| Node.js | 24.17.0 |
| pnpm | 11.7.0 |
| TypeScript | 5.9.3 |
| Vitest | 3.2.7 |
| PostgreSQL | 16.14, Docker Compose |
| MCP TypeScript SDK | 1.29.0, stable v1 line |
| Stripe Node SDK | 22.3.1 |
| External payment mode executed | Fake provider and Stripe test mode |
| Stripe test mode | Executed successfully on July 15, 2026 |

The MCP project currently recommends v1.x for production while v2 remains pre-alpha. MCP was selected because it is a standardized model-controlled tool interface and its in-memory transport tests a real client/server tool call without an external model API. [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [v1 server guide](https://ts.sdk.modelcontextprotocol.io/server), [in-memory transport](https://ts.sdk.modelcontextprotocol.io/classes/inMemory.InMemoryTransport.html).

The OpenAI Agents SDK was considered. It has TypeScript function tools and exposes tool-call details, but its normal agent quickstart requires an API key; LangGraph adds graph/checkpointer concepts not needed to validate one tool boundary. [OpenAI Agents SDK tools](https://openai.github.io/openai-agents-js/guides/tools/), [LangGraph testing](https://docs.langchain.com/oss/javascript/langgraph/test).

## Scenarios executed

| Scenario | Invocations | External effects | Final state | Duplicate prevented |
|---|---:|---:|---|---|
| Unsafe ephemeral-identity retry | 2 | 2 | duplicated business effect | No |
| Guarded fake retry | 2 | 1 | `CONFIRMED` | Yes |
| Timeout after external success | 2 | 1 | `CONFIRMED` after reconciliation | Yes |
| Child-process worker crash | 2 workers | 1 | `CONFIRMED` | Yes |
| Concurrent calls | 10 | 1 | one `CONFIRMED` receipt shared | Yes |
| Reconciliation temporarily unavailable | 3 | 1 | `UNKNOWN`, then `CONFIRMED` | Yes; no blind write |
| Ambiguous reconciliation | 2 | 2 conflicting matches | `NEEDS_REVIEW` | No unsafe retry |
| MCP `call_A` / `call_B` | 2 | 1 | `CONFIRMED` | Yes |
| Support refund workflow | 2 | 1 | refund `CONFIRMED`; case `RESOLVED` | Yes |
| Stripe unsafe `call_A` / `call_B` | 2 | 2 | both test refunds succeeded | No |
| Stripe guarded `call_A` / `call_B` | 2 | 1 | `CONFIRMED` after reconciliation | Yes |

## Agent-native result

The MCP refund tool accepted two trace identifiers:

```text
call_A
call_B
```

Both mapped to:

```text
demo-tenant:order-781:refund:usd:100
```

The first call returned an agent-visible `UNKNOWN` tool error after the fake provider committed. The second call reconciled. PostgreSQL contained one operation, one receipt, one refund, and two ordered `INVOCATION_RECEIVED` events containing `call_A` and `call_B`. The call IDs were absent from the operation key and request fingerprint.

MCP annotations marked the tool non-read-only, destructive, idempotent under stable arguments, and open-world. These remain hints; MCP explicitly says annotations do not change execution semantics. [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [annotation risk vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/).

## Crash and concurrency evidence

- Ten `WriteGuard` instances called one key concurrently.
- All ten callers received the same receipt ID.
- PostgreSQL contained one durable operation.
- The fake provider contained exactly one refund.
- A spawned Node child process persisted `SUBMITTED`, committed the fake-provider refund, printed a non-sensitive commit marker, and exited with code 17 before confirmation.
- A new process-equivalent worker waited for the lease, recorded `STALE_SUBMISSION_BECAME_UNKNOWN`, reconciled, and confirmed the original refund.

## Support workflow result

After `call_A` lost the acknowledgement:

```text
support case: OPEN
refund status: PENDING
external refunds: 1
```

After `call_B` reconciled:

```text
support case: RESOLVED
refund status: CONFIRMED
external refunds: 1
receipt: CONFIRMED / reconciled_after_unknown_outcome
```

WriteGuard guarantees the refund operation lifecycle, not an atomic transaction with the support table. The application owns the `PENDING -> CONFIRMED -> RESOLVED` continuation. That update is retryable because a later call receives the same terminal receipt.

## Real Stripe test-mode evidence

The Stripe network path was executed successfully in test mode on July 15, 2026. The credential was supplied only to the process environment and was not written to the repository or printed by the demo.

The run:

1. reject non-test keys;
2. create/reuse a succeeded PaymentIntent with capacity for three partial refunds;
3. create two unsafe refunds using distinct idempotency keys derived from `call_A` and `call_B`;
4. create one guarded refund with the WriteGuard operation ID as Stripe key and metadata;
5. lose local confirmation;
6. reconcile from a second `WriteGuard` worker;
7. verify PaymentIntent, metadata, amount, currency, and status;
8. print only test object IDs, amounts, safe metadata, counts, and the receipt.

```powershell
$env:STRIPE_SECRET_KEY = "<Stripe test secret>"
pnpm demo:stripe
```

Observed external evidence:

| Path | Agent calls | Stripe refunds | Total partial amount |
|---|---:|---:|---:|
| Unsafe, ephemeral identity | 2 | 2 | 200 minor units |
| Guarded, stable business identity | 2 | 1 | 100 minor units |

Non-sensitive Stripe test object evidence:

```text
validation run: 4234619a-b52a-4593-b53e-8bb78c8b9224
PaymentIntent:   pi_3TtKvlGSgFFA2bza3326GZ3S (500 usd, livemode=false)
unsafe refund 1: re_3TtKvlGSgFFA2bza3rBI5ff3 (100, succeeded)
unsafe refund 2: re_3TtKvlGSgFFA2bza33DJIgCO (100, succeeded)
guarded refund:  re_3TtKvlGSgFFA2bza3oJS2Dcp (100 usd, succeeded)
guarded receipt: a0784321-ca5e-4274-baac-9018b1c38722 (CONFIRMED)
```

The first guarded invocation reached Stripe and then deliberately lost its local acknowledgement, producing `UNKNOWN`. The second invocation used a different framework call ID, found the refund by WriteGuard operation metadata, verified the PaymentIntent, amount, currency, and status, and returned the existing receipt with `resolution=reconciled_after_unknown_outcome` and `duplicateExecutionPrevented=true`.

This comparison uses Stripe idempotency on both paths. The unsafe path fails because each regenerated tool-call ID produces a different provider key; the guarded path decides provider identity from the stable business operation.

## Security validation

- `.env` is ignored and absent from the repository.
- The Stripe command rejects live and unrecognized keys.
- Tests cover live-key rejection.
- `pnpm security:scan` found no credential-shaped source values.
- Payment-method/card details are never persisted or printed.
- Operation/invocation metadata passes through redaction.
- The Stripe evidence output excludes the secret.

## Test result

The full credential-free suite produced:

```text
unit tests:         18 passed
integration tests: 12 passed
total tests:        30 passed
typecheck:          passed
production build:   passed
secret scan:        passed
```

The separate `pnpm test:concurrency` command also passed both the 10-caller race and child-process crash test.

## Remaining uncertainty and thesis-weakening evidence

- The Stripe reconciliation path is validated for one test-mode PaymentIntent and three partial refunds, but not yet under provider rate limiting, delayed Stripe consistency, pagination beyond 100 refunds, or webhook delivery.
- Stripe cannot directly filter refund listing by arbitrary metadata; reconciliation depends on a bounded PaymentIntent list plus local filtering.
- Stripe native idempotency already solves much of the problem when applications maintain a correct stable key. WriteGuard's extra value appears when identity crosses frameworks/workers and when receipts/reconciliation are otherwise bespoke.
- Refund compensation is not credible; the action is treated as irreversible.
- A negative provider lookup remains insufficient proof of non-submission in this MVP and escalates to review.
- The support-case continuation is application-managed, not a distributed transaction.
- The first guarded action still requires 35-50 lines of semantic provider/business logic.
- Adapter reuse and time-to-integrate have not been validated with a design partner or second real provider.

## Reproduction

```powershell
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm test
pnpm test:integration
pnpm test:concurrency
pnpm demo:ordinary
pnpm demo:fake -- --scenario=success
pnpm demo:agent
pnpm demo:support-refund
pnpm validate:milestone-2
```

`pnpm validate:milestone-2` is credential-free and excludes the Stripe network command.

## Recommended design-partner integration

Integrate one existing TypeScript support or operations agent that already issues Stripe test refunds. Ask the team to provide its real order/refund key, existing retry logic, and support-case continuation. Measure integration time, code removed/added, false `NEEDS_REVIEW` rate, and whether its current framework regenerates call IDs during replay. Run the same test with the team's durable runtime rather than replacing it.
