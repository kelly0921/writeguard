# Provider Adapter Authoring

A WriteGuard adapter is the application-owned semantic boundary around one external action. WriteGuard supplies durable identity, claims, uncertainty handling, reconciliation orchestration, verification routing, and receipts. The adapter supplies provider truth.

## 1. Choose the business-operation key

The key must identify one business intention across process restarts and regenerated agent call IDs.

Good:

```text
tenant_123:order_781:refund:usd:100
```

Unsafe:

```text
call_A
```

Include fields that distinguish genuinely separate intentions. Exclude transport request IDs, worker IDs, retry counters, and framework call IDs. Put material input in the fingerprint so reuse of one key with different input fails closed.

## 2. Use provider idempotency

Use the WriteGuard `operationId`, or a deterministic derivative, as the provider idempotency key when supported. Native idempotency protects the provider request; WriteGuard protects durable identity across frameworks, controls retry after uncertainty, verifies the postcondition, and records the receipt.

Document provider retention. If the provider discards idempotency records before WriteGuard's operation retention ends, reconciliation becomes more important.

## 3. Propagate a correlation marker

Attach the WriteGuard operation ID to provider metadata when the provider supports it. Do not put customer messages, card data, secrets, or unrestricted arguments into provider or WriteGuard metadata.

If arbitrary metadata cannot be queried, identify a bounded parent resource such as a PaymentIntent, payout, order, or deployment and filter its children locally.

## 4. Reconcile cardinality explicitly

Return one of four outcomes:

- `not_found`: no visible match; absence is not proof that submission never occurred;
- `found`: exactly one candidate;
- `ambiguous`: more than one candidate, with sanitized provider references;
- `unavailable`: the lookup could not currently establish state.

Enforced WriteGuard behavior:

| Outcome | Result |
|---|---|
| zero matches | `NEEDS_REVIEW`; no blind retry |
| one verified match | `CONFIRMED` |
| multiple matches | `NEEDS_REVIEW` with unresolved references |
| unavailable | remains `UNKNOWN`; caller may resume later |

Shadow behavior is observational. The same outcomes become classifications and never suppress or initiate a write.

## 5. Verify the postcondition

Verification should check all fields required to prove the business result, typically:

- provider resource type and parent resource;
- operation correlation marker;
- amount and currency;
- destination or account when relevant;
- terminal provider status;
- tenant or environment boundary;
- whether the resource was reversed, canceled, or superseded.

Do not treat an HTTP success response alone as proof. Verification may run on the direct execution result or on a later reconciliation result.

## 6. Classify reversibility honestly

- `reversible_write`: a reliable inverse is normally available.
- `conditionally_reversible`: reversal depends on provider state or timing.
- `irreversible_write`: rollback is not a credible automated guarantee.

Compensation is a new external action, not a database rollback. A failed compensation ends in review.

## 7. Handle sensitive data

Store only the minimum non-sensitive metadata needed for operations and support. Configure `sensitiveFields` for domain-specific paths. WriteGuard also redacts common credential, authorization, card, and token keys.

Pilot telemetry has no payload field. Its local JSONL records contain only a fixed metric name, timestamp, and optional duration.

## 8. Run the conformance kit

The package exposes a framework-neutral runner:

```ts
import { defineAdapterContractTests } from "@closure/writeguard/testing";

const contract = defineAdapterContractTests({
  name: "my-provider",
  provider: {
    id: "my-provider-adapter",
    version: "1.0.0",
    environment: "test_mode"
  },
  createHarness: async scenario => ({
    key: `contract:${scenario}`,
    fingerprint: { scenario },
    execute,
    reconcile,
    verify,
    getProviderReference: result => result.id,
    countExternalEffects
  })
});

const results = await contract.run();
if (results.some(result => !result.passed)) throw new Error(JSON.stringify(results));

const receipt = await contract.runReceipt();
```

Required scenarios are success, confirmed failure, timeout after success, duplicate invocation, reconciliation unavailable, and ambiguous matches.

`run()` remains the simple test-runner API. `runReceipt()` returns a deterministic, runtime-validated `writeguard.adapter-conformance/v1` receipt with sanitized per-scenario status, verified guarantees, limitations, and an explicit evidence environment:

- `simulated`: deterministic local provider only;
- `test_mode`: a named provider's non-production environment;
- `production`: production evidence, which must be set deliberately and is never inferred.

An adapter may explicitly return `{ unsupported: true, reason }` for a scenario it cannot implement. The receipt reports `unsupported` and `passed_with_unsupported`; it never fabricates a pass. Raw provider errors are not copied into receipts. Passing simulated or test-mode scenarios does not prove production semantics.

## Adapter acceptance checklist

- Stable key does not use framework call identity.
- Fingerprint covers all material parameters.
- Provider idempotency and retention are documented.
- Correlation metadata or bounded lookup exists.
- Zero, one, multiple, and unavailable matches are tested.
- Verification checks the actual business postcondition.
- Reversibility claim is credible.
- Logs, metadata, receipts, and telemetry exclude sensitive payloads.
- Conformance receipt is valid, names the correct environment, and has no failed or unexpectedly unsupported scenario.
- A sandbox lost-acknowledgement run creates exactly one effect.
