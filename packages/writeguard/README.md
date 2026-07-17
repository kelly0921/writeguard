# `@closure/writeguard`

WriteGuard gives agent-triggered external writes a stable business-operation identity, a durable PostgreSQL claim, explicit `UNKNOWN` handling, reconciliation, verification, and a terminal receipt.

The unreleased 0.8.0 Build Week line exposes deterministic MCP tool normalization plus versioned analysis and generation-approval contracts through `@closure/writeguard/analysis`. GPT-5.6 analysis, source generation, generated-integration verification, receipt policy, and report rendering live in separate optional packages and remain outside runtime execution.

## Install

```bash
pnpm add @closure/writeguard
```

The package is not published automatically from this repository. Use `pnpm package:verify` to build and install the local tarball into a clean fixture.

## Normalize an MCP tool definition

```bash
writeguard normalize-mcp ./refund-order.json --pretty
```

The command emits only machine-readable normalized JSON to stdout. Invalid JSON or MCP definitions produce actionable stderr messages and a nonzero exit code. It does not call GPT-5.6, perform risk analysis, generate code, or execute a tool.

```ts
import {
  normalizeMcpToolDefinition,
  type ToolRiskAnalyzer
} from "@closure/writeguard/analysis";

const normalized = normalizeMcpToolDefinition({
  name: "refund_order",
  description: "Refund an order",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string" } },
    required: ["orderId"]
  }
});
```

The analysis subpath separates normalized source, recommendation-only analysis, and developer review. An analyzer implementation is injected through `ToolRiskAnalyzer`; the deterministic package includes no model implementation or API-key requirement.

## Analyze with the optional GPT-5.6 package

```bash
writeguard analyze ./refund-order.json --pretty
```

The command dynamically loads `@closure/writeguard-analyzer-openai` and requires `OPENAI_API_KEY` in the process environment. It emits exactly one validated `RiskAnalysisResult` to stdout. The artifact identifies `openai.gpt-5.6`, remains `recommendation_only`, and contains only proposals marked `requires_developer_approval`. Errors, refusals, incomplete responses, invalid schemas, model mismatches, and unsupported provider claims go to stderr with exit code 4; no partial recommendation is emitted.

`normalize-mcp` remains the deterministic no-network path and does not require the optional package. The OpenAI package sends the complete normalized tool definition to OpenAI, so remove real credentials, personal data, and sensitive examples/defaults first. See the optional package README for timeout, retry, privacy, cost, and prompt-injection limitations.

Create, edit, approve, and generate from separate bound artifacts:

```text
writeguard review --tool normalized.json --analysis analysis.json --out review.json
writeguard approve --tool normalized.json --analysis analysis.json --review review.json --reviewer developer-id --out approved.json
writeguard generate --tool normalized.json --analysis analysis.json --review approved.json --out-dir generated/tool
```

The review file starts in `draft` state with enforcement and reconciliation-hook acknowledgements false. Approval requires the developer to edit and confirm every relevant decision; there is no `--yes` bypass. Generation requires the optional `@closure/writeguard-generator`, verifies source/analysis/provenance/model/review/generator bindings, and refuses unsupported capabilities or existing output paths. It is deterministic, network-free, and API-key-free.

## Verify a generated integration

Safe static verification is the default:

    writeguard verify generated/tool --pretty

Include a separate provider implementation in static shape and compilation checks:

    writeguard verify generated/tool --provider-file provider/simulated.ts --strict --pretty

Execute the manifest-owned generated failure test only with explicit opt-in:

    writeguard verify generated/tool --provider-file provider/simulated.ts --strict --run-tests --pretty

The command emits a `writeguard.verification/v1` run to stdout and returns exit code 6 when required verification fails. Operational errors and the `--run-tests` child-process disclosure use stderr. Static mode never executes generated JavaScript or target package scripts. The verifier ignores target TypeScript plugins and uses fixed compiler arguments.

Passing verification proves only the levels stated in the receipt. Hashes establish integrity and binding, not authenticity. Compilation proves public API type compatibility. Simulated generated tests do not establish real-provider behavior, and real-provider semantics remain `not_run` unless a separate provider-specific conformance workflow actually runs.

Evaluate a receipt against a versioned policy:

    writeguard policy check verification.json --policy writeguard.policy.json --pretty

Policy pass exits 0; invalid or unmet policy exits 7. The optional generator package performs the evaluation. It evaluates named evidence already present in the receipt and never converts undeclared or unverified provider behavior into a pass.

## PostgreSQL setup

```ts
import {
  createPostgresStorage,
  createWriteGuard,
  migratePostgresStorage
} from "@closure/writeguard";

const connectionString = process.env.DATABASE_URL!;
await migratePostgresStorage({ connectionString });

const storage = createPostgresStorage({ connectionString });
const writeGuard = createWriteGuard({
  storage,
  namespace: "customer-support"
});
```

Applications do not call internal tables or state transitions. Run migrations during deployment, create one storage handle per process, and close it on shutdown.

## Guard an action

```ts
const receipt = await writeGuard.execute({
  key: "tenant_123:order_781:refund:usd:100",
  action: {
    name: "refund_order",
    provider: "stripe",
    effectType: "conditionally_reversible"
  },
  fingerprint: { tenantId: "tenant_123", orderId: "order_781", amount: 100, currency: "usd" },
  execute: ({ operationId }) => stripeRefundAdapter.execute(operationId),
  reconcile: ({ operationId }) => stripeRefundAdapter.reconcile(operationId),
  verify: (refund, { operationId }) => stripeRefundAdapter.verify(refund, operationId),
  getProviderReference: (refund) => refund.id
});
```

The business key, provider reconciliation, and postcondition verification remain application responsibilities. Never derive the key solely from a framework tool-call ID.

## Shadow mode

`observe` records stable identity and repeated invocations but never calls an execute hook, suppresses an invocation, or initiates an external write.

```ts
const observation = await writeGuard.observe({
  key,
  action,
  reportedInvocation: {
    framework: "mcp",
    toolName: "refund_order",
    toolCallId: "call_B"
  },
  reconcile: ({ operationKey }) => adapter.lookupByBusinessKey(operationKey),
  verify: (refund) => refund.status === "succeeded"
});
```

`wouldSuppressDuplicate` is a counterfactual based on stable identity. Shadow mode cannot prove that an uncontrolled application actually executed, skipped, or duplicated a write unless provider reconciliation can observe it.

## Pilot telemetry

```ts
import { createLocalPilotTelemetry } from "@closure/writeguard";

const telemetry = createLocalPilotTelemetry({
  filePath: ".writeguard/pilot-telemetry.jsonl"
});
```

The JSONL file contains only metric name, timestamp, and optional duration. It has no API for attaching payloads, customer messages, credentials, or provider responses.

## In-memory storage

`createUnsafeInMemoryStorage()` exists only for tests, package verification, and demonstrations. It loses claims on process exit and is not a production reliability mechanism.

## Supported exports

- `createWriteGuard`, `WriteGuardClient`
- `createPostgresStorage`, `migratePostgresStorage`
- `createUnsafeInMemoryStorage`
- `createLocalPilotTelemetry`, `PilotTelemetry`
- execution, observation, receipt, reconciliation, telemetry, and tool types
- classified error classes and `isUnknownExecutionOutcome`
- `@closure/writeguard/testing` six-scenario adapter conformance helpers and `writeguard.adapter-conformance/v1` receipts with explicit simulated/test-mode/production labels
- `@closure/writeguard/analysis` normalized-tool, analysis, proposal, review, approval-bound generation request, provenance, serialization, and injectable-analyzer contracts

No internal state-machine, SQL-row, fake-provider, or schema module is exported.

## Versioning

Until `1.0.0`, minor releases may refine public types with migration notes. Patch releases must preserve behavior and types. A future `1.0.0` means the storage schema, receipt vocabulary, and package API have completed at least one external design-partner cycle.
