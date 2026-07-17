# Closure / WriteGuard

WriteGuard is a small TypeScript execution guard for consequential external writes. It proves one narrow thesis: when an external action succeeds but the caller loses the acknowledgement, a retry should reconcile the uncertain result before it considers executing the action again.

It is intended for agent-tool, backend, platform, reliability, and payments developers evaluating how to protect consequential provider actions without putting a model in the enforcement path.

This repository is an evaluation release candidate, not a production payment system or a general agent framework. **Sandbox and external evaluation only; not production-certified.** Real external-developer results recorded so far: zero.

The current unreleased line is `@closure/writeguard@0.8.0`, `@closure/writeguard-analyzer-openai@0.1.1`, and `@closure/writeguard-generator@0.3.0`. Iteration 5 turns the existing journey into one evidence-producing evaluation without adding a model to runtime enforcement. See [BUILD_WEEK.md](BUILD_WEEK.md).

## Evaluate locally

Requirements: Node.js 20+ and pnpm. No API key, provider credential, Docker, PostgreSQL, or prior WriteGuard knowledge is required.

```powershell
pnpm install --frozen-lockfile
pnpm evaluate:local
```

Recorded Windows runs have taken roughly 40–80 seconds; allow up to two minutes depending on package-cache and registry conditions. This is automated command time, not developer onboarding time. Windows 11 is locally validated. The checked CI example targets Windows and Ubuntu, but remote CI has not run; macOS remains unvalidated.

This canonical command installs packed public packages into a clean temporary consumer, then demonstrates:

`Tool → Analyze → Review → Approve → Generate → Verify → Integrate`

The analysis step uses a runtime-validated, deterministic recorded GPT-5.6-compatible fixture and makes no live model call. Approval is separate and explicit. The command compares two unsafe simulated effects with one guarded simulated effect; verifies artifact bindings and controlled compilation; opts into only the manifest-owned generated tests; runs the public six-scenario adapter conformance kit; applies a versioned receipt policy; and renders one summary derived from the receipts.

The resulting sanitized artifacts are written under `.writeguard/evaluation-*`. The summary clearly labels the provider as simulated and real-provider semantics as `not_run`. It does not prove production behavior, provider correctness, or the under-ten-minute external-developer outcome. See [the evaluation runbook](docs/EVALUATION_RUNBOOK.md).

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
- `packages/generator`: optional, network-free approval-bound generator plus static/opt-in generated-integration verifier
- `packages/stripe-adapter`: Stripe test-mode refund execution, reconciliation, and verification
- `apps/refund-demo`: CLI comparison and operation timeline
- `apps/agent-demo`: MCP refund tool with two framework call IDs and one business operation
- `apps/support-refund`: application-managed support-case continuation around a guarded refund
- `apps/design-partner-starter`: external-consumer example with unsafe, manual, shadow, enforced, and MCP paths
- `apps/pilot-sandbox`: validated localhost configuration, fake/Stripe-test workflows, diagnostics, and sanitized export
- `examples`: copyable shadow and enforced templates that import only the public package
- `fixtures/package-consumer`: clean project installed from the packed tarball during verification
- `fixtures/evaluation-release-candidate`: canonical packed-package, zero-credential evaluation consumer
- `tests`: unit and live-PostgreSQL integration coverage
- `docs`: research, architecture, failure model, roadmap, and founder findings

The Drizzle schema describes the database, while the correctness-critical claiming path uses explicit parameterized PostgreSQL transactions and `SELECT ... FOR UPDATE`. This keeps the concurrency behavior visible in the MVP.

## Design-time product journey

The canonical evaluator above is the recommended first experience. The lower-level commands below are for developers adapting their own tool.

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

Complete the approval-bound workflow with reviewable files:

```powershell
pnpm writeguard normalize-mcp fixtures/mcp-tools/refund-order.json --pretty > normalized-tool.json
pnpm writeguard analyze fixtures/mcp-tools/refund-order.json --pretty > analysis.json
pnpm writeguard review --tool normalized-tool.json --analysis analysis.json --out review.json --pretty

# Edit review.json. Confirm the selected operation, identity, enforcement transition,
# reconciliation hook, redaction fields, and generated failure scenarios.
pnpm writeguard approve --tool normalized-tool.json --analysis analysis.json `
  --review review.json --reviewer "developer-id" --out approved-review.json --pretty

pnpm writeguard generate --tool normalized-tool.json --analysis analysis.json `
  --review approved-review.json --out-dir generated/refund --pretty
```

`review` never approves. The editable draft starts with `enforcementAcknowledged` and `developerSuppliedHookAcknowledged` set to `false`; `approve` exits nonzero until required acknowledgements and any optional/application-supplied identity decisions are explicit. There is no `--yes` bypass. `generate` verifies every source, analysis, provenance, identity, model, review, and generator binding before the optional `@closure/writeguard-generator` package writes a new directory.

Generated output contains typed input, wrapper, provider-boundary, configuration, executable failure tests, a bound verification bundle, README, package metadata, and `writeguard-generation.json` content digests. Generation is byte-deterministic, makes no network request, executes no source or generated code, and never needs an API key. The provider executor, reconciliation, verification, durable production storage, and real provider validation remain developer-supplied.

Verify integrity and compilation without executing generated code:

```powershell
pnpm writeguard verify generated/refund --pretty
```

Include a separate provider implementation and explicitly run only the manifest-owned generated failure test:

```powershell
pnpm writeguard verify generated/refund --provider-file provider/simulated.ts --strict --pretty
pnpm writeguard verify generated/refund --provider-file provider/simulated.ts --strict --run-tests --pretty
```

Static verification validates paths, symlinks, sizes, inventory, digests, the complete source/analysis/review/generator binding bundle, import and secret policy, provider-boundary shape, and TypeScript compilation with verifier-controlled arguments. It does not load target TypeScript plugins or package scripts. `--run-tests` is an explicit code-execution boundary with time/output limits and a minimized environment, but it is not a security sandbox. Every receipt keeps real-provider semantics `not_run` unless a separate real-provider conformance workflow genuinely ran. Hashes prove integrity and binding, not authenticity.

For the PostgreSQL-backed Milestone 4 sandbox, use the [pilot quickstart](docs/PILOT_QUICKSTART.md):

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
pnpm evaluate:local
pnpm validate:design-partner
```

On Bash, use `export TEST_DATABASE_URL=postgresql://closure:closure@localhost:54327/closure` instead.

The ordinary retry demo intentionally creates two fake refunds after two ambiguous timeouts. The WriteGuard demo creates one refund, injects a failure after provider success, records `UNKNOWN`, reconciles on the second invocation, and returns a receipt with `duplicateExecutionPrevented: true`.

## Installable package

Milestone 3 added `@closure/writeguard` version `0.3.0`. The unreleased Build Week 0.8.0 line preserves `.`, `./testing`, and `./analysis`; dynamically loads `@closure/writeguard-analyzer-openai@0.1.1` only for `analyze`; and dynamically loads `@closure/writeguard-generator@0.3.0` only for `generate`, `verify`, and receipt-policy evaluation.

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

Use a freshly rotated Stripe test secret only, read without echoing it:

```powershell
$secureKey = Read-Host "Fresh Stripe test secret" -AsSecureString
$env:STRIPE_SECRET_KEY = [Net.NetworkCredential]::new("", $secureKey).Password
pnpm demo:stripe
Remove-Item Env:STRIPE_SECRET_KEY
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
- 145 unit tests pass, including 27 optional-analyzer tests plus approval, generation, verification, controlled execution, CLI, determinism, and adversarial filesystem/security coverage.
- 20 PostgreSQL/MCP/support/concurrency/shadow/starter/pilot integration tests pass against Docker Compose.
- 165 repository tests pass; five separately generated failure tests and six external-pilot-specific tests also compile and pass.
- A clean tarball consumer imports the public package, typechecks, reconciles `UNKNOWN`, and creates one external effect.
- A second clean consumer installs the core and optional analyzer tarballs, typechecks their declarations, runs the public analyzer with an injected fake transport, and verifies packaged CLI missing-key failure without a network call.
- A third clean consumer installs the core and generator tarballs, typechecks public declarations, generates, stages, statically verifies, explicitly executes the generated test, exercises the packaged CLI, and confirms no OpenAI production dependency.
- Separate refund and email clean consumers install packed packages, use recorded offline analysis fixtures, approve different operation identities, implement simulated providers, produce receipts, and pass three pilot-specific tests each. Their real-provider level remains `not_run`.
- The core and generator production dependency graphs contain no OpenAI SDK. The credential-gated GPT-5.6 model-quality evaluation passed all 9/9 fixtures with a sanitized report.
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
- Generated verification is design-time evidence. Static compilation does not establish provider correctness, and opt-in child-process execution is not a security sandbox.
- Generated simulated-provider tests do not prove real provider idempotency, reconciliation cardinality, consistency windows, or verification semantics.
- Deterministic generation supports bounded direct object/array JSON Schemas; recursive references and `oneOf`/`anyOf`/`allOf` are rejected.

Read [the Milestone 4 validation](docs/MILESTONE_4_VALIDATION.md), [pilot quickstart](docs/PILOT_QUICKSTART.md), [runbook](docs/PILOT_RUNBOOK.md), [rollback guide](docs/PILOT_ROLLBACK.md), [success criteria](docs/PILOT_SUCCESS_CRITERIA.md), [compatibility matrix](docs/COMPATIBILITY.md), [the Milestone 3 validation](docs/MILESTONE_3_VALIDATION.md), [integration experience](docs/INTEGRATION_EXPERIENCE.md), [adapter authoring guide](docs/ADAPTER_AUTHORING.md), [design-partner guide](docs/DESIGN_PARTNER_GUIDE.md), [pilot questionnaire](docs/PILOT_QUESTIONNAIRE.md), and [product boundary](docs/PRODUCT_BOUNDARY.md) before using the package beyond a focused sandbox pilot.
