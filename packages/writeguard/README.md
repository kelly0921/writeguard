# `@closure/writeguard`

WriteGuard gives agent-triggered external writes a stable business-operation identity, a durable PostgreSQL claim, explicit `UNKNOWN` handling, reconciliation, verification, and a terminal receipt.

The unreleased 0.4.0 Build Week line also exposes deterministic MCP tool normalization and versioned design-time contracts through `@closure/writeguard/analysis`. AI analysis remains optional and outside the runtime execution path.

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
- `@closure/writeguard/testing` adapter conformance helpers

No internal state-machine, SQL-row, fake-provider, or schema module is exported.

## Versioning

Until `1.0.0`, minor releases may refine public types with migration notes. Patch releases must preserve behavior and types. A future `1.0.0` means the storage schema, receipt vocabulary, and package API have completed at least one external design-partner cycle.
