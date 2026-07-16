# Closure / WriteGuard

WriteGuard is a small TypeScript execution guard for consequential external writes. It proves one narrow thesis: when an external action succeeds but the caller loses the acknowledgement, a retry should reconcile the uncertain result before it considers executing the action again.

This repository is prepared for external sandbox pilot operations, not a production payment system or a general agent framework. **Sandbox and design-partner evaluation only; not production-certified.** External pilot results recorded so far: zero.

OpenAI Build Week starts from the local 0.3.0 baseline, checkpoints Iteration 1 at unreleased 0.4.0, and advances the working core package to unreleased 0.5.0. Iteration 2 adds an optional GPT-5.6 design-time analyzer without adding a model to runtime enforcement. See [BUILD_WEEK.md](BUILD_WEEK.md).

## What the proof demonstrates

```text
provider commits refund
        |
caller loses acknowledgement
        |
operation is persisted as UNKNOWN
        |
same operation key is invoked again
        |
provider is reconciled and result is verified
        |
one refund exists and a durable CONFIRMED receipt is returned
```

WriteGuard owns stable operation identity, PostgreSQL-backed claiming, cross-process deduplication, an explicit `UNKNOWN` state, provider reconciliation, postcondition verification, receipts, deterministic fault injection, and conservative human-review escalation. It does not own agent planning, scheduling, workflow orchestration, prompts, model routing, memory, authorization, or a broad observability platform.

## Repository layout

- `packages/core`: states, errors, security helpers, PostgreSQL and in-memory ledgers, migrations, and fake provider
- `packages/sdk`: the framework-neutral `WriteGuard.execute()` primitive
- `packages/writeguard`: publishable `@closure/writeguard` facade, declarations, migration API, shadow mode, telemetry, and adapter test kit
- `packages/writeguard/src/analysis`: versioned analysis contracts, MCP normalization, and injectable analyzer boundary
- `packages/analyzer-openai`: optional GPT-5.6 Responses API analyzer; the only workspace package with an OpenAI SDK dependency
- `packages/stripe-adapter`: Stripe test-mode refund execution, reconciliation, and verification
- `apps/refund-demo`: CLI comparison and operation timeline
- `apps/agent-demo`: MCP refund tool with two framework call IDs and one business operation
- `apps/support-refund`: application-managed support-case continuation around a guarded refund
- `apps/design-partner-starter`: external-consumer example with unsafe, manual, shadow, enforced, and MCP paths
- `apps/pilot-sandbox`: validated localhost configuration, fake/Stripe-test workflows, diagnostics, and sanitized export
- `examples`: copyable shadow and enforced templates that import only the public package
- `fixtures/package-consumer`: clean project installed from the packed tarball during verification
- `tests`: unit and live-PostgreSQL integration coverage
- `docs`: research, architecture, failure model, roadmap, and founder findings

The Drizzle schema describes the database, while the correctness-critical claiming path uses explicit parameterized PostgreSQL transactions and `SELECT ... FOR UPDATE`. This keeps the concurrency behavior visible in the MVP.

## Quick start

Requirements: Node.js 20+, pnpm, and Docker Desktop or another reachable PostgreSQL instance.

Normalize an MCP tool definition without a model or network call:

```powershell
pnpm writeguard normalize-mcp fixtures/mcp-tools/refund-order.json --pretty
```

Run GPT-5.6 design-time analysis after building the optional package and setting the API key only in the current process environment:

```powershell
pnpm --filter @closure/writeguard build
pnpm --filter @closure/writeguard-analyzer-openai build
$secureKey = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [Net.NetworkCredential]::new("", $secureKey).Password
pnpm writeguard analyze fixtures/mcp-tools/refund-order.json --pretty
Remove-Item Env:OPENAI_API_KEY
```

Do not paste keys into chat, source, fixtures, command arguments, logs, or committed `.env` files. `analyze` sends the complete normalized tool definition—including descriptions, schema metadata, examples, and defaults—to OpenAI. Remove real secrets and personal data first. Output is a `recommendation_only` artifact whose analyzer identity is `openai.gpt-5.6`; incomplete, refused, invalid, mismatched, or unsupported results exit nonzero without partial JSON on stdout.

For the one-command Milestone 4 sandbox, use the [pilot quickstart](docs/PILOT_QUICKSTART.md):

```powershell
pnpm install --frozen-lockfile
pnpm pilot:start
pnpm pilot:validate
pnpm writeguard:doctor
```

The detailed developer baseline remains:

```powershell
pnpm install
Copy-Item .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm test:unit
$env:TEST_DATABASE_URL = "postgresql://closure:closure@localhost:54327/closure"
pnpm test:integration
pnpm test:concurrency
pnpm demo:ordinary
pnpm demo:fake -- --scenario=success
pnpm demo:agent
pnpm demo:support-refund
pnpm package:verify
pnpm demo:starter
pnpm demo:public
pnpm validate:design-partner
```

On Bash, use `export TEST_DATABASE_URL=postgresql://closure:closure@localhost:54327/closure` instead.

The ordinary retry demo intentionally creates two fake refunds after two ambiguous timeouts. The WriteGuard demo creates one refund, injects a failure after provider success, records `UNKNOWN`, reconciles on the second invocation, and returns a receipt with `duplicateExecutionPrevented: true`.

## Installable package

Milestone 3 added `@closure/writeguard` version `0.3.0`. The unreleased Build Week 0.5.0 line preserves `.` and `./testing`, adds `./analysis`, and dynamically loads the separate unreleased `@closure/writeguard-analyzer-openai@0.1.0` package only for `writeguard analyze`.

```ts
import {
  createPostgresStorage,
  createWriteGuard,
  migratePostgresStorage
} from "@closure/writeguard";

await migratePostgresStorage({ connectionString });
const storage = createPostgresStorage({ connectionString });
const writeGuard = createWriteGuard({
  storage,
  namespace: "customer-support"
});
```

`pnpm package:verify` packs the package, installs the tarball into a fresh fixture, typechecks the consumer, and runs a lost-acknowledgement guarded action. It does not publish to npm.

The in-memory storage factory is named `createUnsafeInMemoryStorage` and is only for tests and demonstrations.

## Small API

```ts
const receipt = await writeGuard.execute({
  key: "tenant_123:order_781:refund",
  action: {
    name: "stripe.refund.create",
    provider: "stripe",
    effectType: "reversible_write"
  },
  fingerprint: { paymentIntentId, amount },
  metadata: { paymentIntentId, amount },

  execute: (context) =>
    stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount,
        metadata: { write_guard_operation_id: context.operationId }
      },
      { idempotencyKey: context.operationId }
    ),

  reconcile: async (context) => {
    // Return found, not_found, ambiguous, or unavailable.
    return findRefundByPaymentIntentAndOperationId(paymentIntentId, context.operationId);
  },

  verify: async (refund, context) =>
    refund.status === "succeeded" &&
    refund.metadata?.write_guard_operation_id === context.operationId
});
```

Reconciliation uses an explicit cardinality result rather than `T | null`, because "not visible," "not found," and "multiple matches" have different safety consequences.

## Shadow mode and pilot telemetry

`writeGuard.observe()` persists stable identity, redacted invocation traces, duplicate invocation counts, and optional reconciliation classifications. It has no execute hook and never initiates or suppresses a write. Every result is marked `mode: "shadow"` and `observational: true`.

Optional local telemetry writes JSONL records containing only a fixed metric name, timestamp, and optional duration. Generate a summary with:

```powershell
pnpm writeguard:report -- --file=.writeguard/pilot-telemetry.jsonl
```

No hosted analytics service is included.

## Fake-provider scenarios

```powershell
pnpm demo:fake -- --scenario=success
pnpm demo:fake -- --scenario=confirmed_failure
pnpm demo:fake -- --scenario=timeout_before_submission
pnpm demo:fake -- --scenario=timeout_after_success
pnpm demo:fake -- --scenario=delayed_reconciliation --delay-ms=500
pnpm demo:fake -- --scenario=conflicting_results
```

Duplicate invocation is demonstrated by `pnpm demo:ordinary` and by the concurrency tests. The CLI prints the append-only state timeline and receipt. To re-open an operation later:

```powershell
pnpm inspect -- --key=tenant_demo:pi_fake_123:refund
```

Use the exact operation key printed by the demo and the same `WRITEGUARD_NAMESPACE`.

## Stripe test-mode demo

Only a Stripe test secret is accepted. Never put a live key in this repository.

```powershell
$env:STRIPE_SECRET_KEY = "sk_test_..."
pnpm demo:stripe
```

The command creates or reuses a sufficiently funded test PaymentIntent. It first creates two unsafe partial refunds using distinct Stripe idempotency keys derived from `call_A` and `call_B`. It then runs the guarded path: the WriteGuard operation ID becomes Stripe metadata and the provider key, local confirmation is lost, and a second worker reconciles exactly one guarded refund.

The Stripe network path was executed successfully in test mode on July 15, 2026: two unsafe agent call identities produced two partial refunds, while the guarded path reconciled two agent invocations to one verified partial refund. The non-sensitive test-object evidence is recorded in `docs/MILESTONE_2_VALIDATION.md`.

## Receipt shape

```json
{
  "operationId": "f4b7...",
  "operationKey": "tenant_123:order_781:refund",
  "action": "stripe.refund.create",
  "status": "CONFIRMED",
  "verified": true,
  "providerReference": "re_123",
  "attempts": 2,
  "resolution": "reconciled_after_unknown_outcome",
  "duplicateExecutionPrevented": true,
  "verificationEvidence": {},
  "unresolvedEffects": []
}
```

Operation metadata is redacted by sensitive key/path rules. Request identity is stored as a deterministic SHA-256 fingerprint; full payment payloads and credentials are not persisted.

## Current verification

- TypeScript typecheck and build pass.
- 72 unit tests pass, including 27 optional-analyzer tests covering the required normal, ambiguous, malformed, adversarial, reliability, and dependency-boundary cases.
- 20 PostgreSQL/MCP/support/concurrency/shadow/starter/pilot integration tests pass against Docker Compose.
- 92 total automated tests pass.
- A clean tarball consumer imports the public package, typechecks, reconciles `UNKNOWN`, and creates one external effect.
- A second clean consumer installs the core and optional analyzer tarballs, typechecks their declarations, runs the public analyzer with an injected fake transport, and verifies packaged CLI missing-key failure without a network call.
- The core production dependency graph contains no OpenAI SDK. Live GPT-5.6 model-quality evaluation is pending because no `OPENAI_API_KEY` was configured during Iteration 2 validation.
- The starter demonstrates unsafe 2, manual 1, and WriteGuard 1 external effect while completing the support case.
- The fake end-to-end demo produced two refunds under ordinary retry and one under WriteGuard.
- Stripe test mode remains credential-gated; one founder-run Stripe test-service validation is documented, but no external design partner has validated the integration and it does not cover rate limiting, webhooks, or large refund histories.

## Known limits

- A negative provider lookup is not proof that submission never happened; the MVP returns `NEEDS_REVIEW` instead of retrying.
- Reconciliation and verification remain provider/action-specific.
- Claims use leases but do not yet heartbeat long-running calls.
- The Stripe adapter scans refunds for one PaymentIntent and metadata marker; production adapters need provider-specific consistency windows, pagination limits, rate handling, and retention rules.
- No hosted control plane, multi-tenant authorization, encryption-key management, retention policy, or operational alerting is included.
- Compensation is an application hook, not a guarantee that the original real-world effect can be reversed.
- Shadow mode cannot prove whether uncontrolled application code executed without provider reconciliation evidence.
- PostgreSQL is the only supported durable storage adapter.
- GPT-5.6 analysis is probabilistic and design-time only. Prompt hierarchy, strict structured output, runtime validation, provenance attachment, safety checks, and adversarial fixtures reduce—but cannot eliminate—prompt-injection and misclassification risk.
- Wrapper generation, failure-test generation, approval CLI, and verification remain Iteration 3 work; an analysis result cannot become runtime policy by itself.

Read [the Milestone 4 validation](docs/MILESTONE_4_VALIDATION.md), [pilot quickstart](docs/PILOT_QUICKSTART.md), [runbook](docs/PILOT_RUNBOOK.md), [rollback guide](docs/PILOT_ROLLBACK.md), [success criteria](docs/PILOT_SUCCESS_CRITERIA.md), [compatibility matrix](docs/COMPATIBILITY.md), [the Milestone 3 validation](docs/MILESTONE_3_VALIDATION.md), [integration experience](docs/INTEGRATION_EXPERIENCE.md), [adapter authoring guide](docs/ADAPTER_AUTHORING.md), [design-partner guide](docs/DESIGN_PARTNER_GUIDE.md), [pilot questionnaire](docs/PILOT_QUESTIONNAIRE.md), and [product boundary](docs/PRODUCT_BOUNDARY.md) before using the package beyond a focused sandbox pilot.
