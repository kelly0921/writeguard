# Research: Transactional Reliability for Agent Writes

Research completed July 14, 2026. Sources below are primary documentation, project pages, or original papers and were accessed on that date unless a publication date is shown.

## Bottom line

The individual ideas are established: provider idempotency, durable retries, workflow journals, sagas/compensation, effect staging, and audit receipts all exist. The credible WriteGuard question is narrower: can stable business-operation identity, cross-process claim coordination, an explicit `UNKNOWN` state, provider-specific reconciliation, independent verification, and a compact receipt be packaged as one framework-neutral action primitive?

Durable runtimes are complements. They preserve and retry program progress, but their own documentation still asks developers to make external side effects idempotent or acknowledges that an activity/step may execute more than once. WriteGuard concentrates on the semantic evidence for one external write.

## Stripe findings

The MVP locks Stripe Node v22.3.1. Stripe's current API supports the required pattern:

- All `POST` requests accept an idempotency key. Stripe stores the first status code and response body for a key, including a `500`; it rejects reuse with different parameters. Documentation says keys can be removed after at least 24 hours, so provider idempotency is not a permanent business-operation ledger. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- Refund creation accepts a PaymentIntent and optional amount. [Create a refund](https://docs.stripe.com/api/refunds/create?lang=nodejs)
- Refund objects support metadata, making `write_guard_operation_id` a searchable/correlatable marker without storing payment details locally. Stripe limits metadata and warns against sensitive data. [Stripe metadata](https://docs.stripe.com/api/metadata?lang=nodejs)
- Refund listing can be filtered by `payment_intent` and paginated. The adapter lists refunds for that intent and then matches the operation metadata. [List refunds](https://docs.stripe.com/api/refunds/list?lang=node)
- Stripe's test environment provides `pm_card_visa`; the demo creates or reuses a succeeded test PaymentIntent. [Stripe testing](https://docs.stripe.com/testing)
- The official Node SDK supports modern Node releases and exposes async pagination used by the adapter. [stripe-node](https://github.com/stripe/stripe-node)

What Stripe solves: duplicate requests within its idempotency behavior and a durable refund object. What it does not choose for the application: the business intent key, how long that identity must remain unique, how to correlate across providers/runtimes, whether a returned refund satisfies the intended invariant, or what to do when a lookup is empty or ambiguous.

## Durable execution systems

| System | What exists | Boundary relevant to WriteGuard |
|---|---|---|
| Temporal | Durable workflows and retry policies. Temporal explicitly documents that an Activity can complete externally and the worker can fail before the server receives the completion, causing the Activity to run again; it recommends idempotency keys. [Activity idempotency](https://docs.temporal.io/activity-definition#idempotency), [retry policies](https://docs.temporal.io/encyclopedia/retry-policies) | Temporal durably schedules/retries work. The application still owns the external action's identity, reconciliation lookup, and postcondition. |
| Restate | Journals handler progress and provides durable steps for nondeterministic/external operations. [Key concepts](https://docs.restate.dev/foundations/key-concepts), [durable steps](https://docs.restate.dev/develop/java/durable-steps) | Restate owns invocation and replay semantics. Provider-specific evidence and ambiguous-outcome policy remain action logic. WriteGuard can run inside a handler/step. |
| DBOS | Durable workflows, transactions, and steps. DBOS architecture guidance says steps that interact with external systems should be idempotent because they may execute more than once. [DBOS architecture](https://docs.dbos.dev/architecture), [workflow tutorial](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial), [outbox example](https://docs.dbos.dev/python/examples/outbox) | DBOS owns durable control flow and database transactions. It does not make an arbitrary third-party write transactionally atomic with its database. |

WriteGuard should not rebuild scheduling, replay, timers, workflow histories, or orchestration. Its value, if validated, is the reusable semantic side-effect contract those systems can call.

## Agent runtimes and MCP

- LangGraph warns that a node restarts from the beginning on resume after an interrupt, and advises making side effects before interrupts idempotent; its functional API similarly places API calls in tasks that may be re-executed. [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), [functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api)
- The OpenAI Agents SDK provides tool invocation, sessions, tracing, timeouts, and run control. These help agent execution and diagnosis, but a tool timeout does not by itself establish whether a downstream provider committed. WriteGuard can sit inside a function tool. [Agents SDK tools](https://openai.github.io/openai-agents-js/guides/tools/), [running agents](https://openai.github.io/openai-agents-js/guides/running-agents/), [sessions](https://openai.github.io/openai-agents-js/guides/sessions/), [tracing](https://openai.github.io/openai-agents-js/guides/tracing/)
- MCP `ToolAnnotations` describe `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. The MCP project states these annotations are untrusted hints, not enforcement, and defaults clients toward caution. [MCP tool annotations](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/), [tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

MCP can communicate effect intent; it does not currently define a durable operation claim, reconciliation procedure, verification evidence, or receipt protocol. A future WriteGuard action contract could complement MCP rather than modify tool transport.

## Emerging transactional-agent work

These papers are close enough that WriteGuard must avoid novelty claims:

- **Atomix: Timely, Transactional Tool Use for Reliable Agentic Workflows** (submitted February 16, 2026) proposes progress-aware transactions, epochs/resource frontiers, buffered effects, and compensation for externalized effects. It is broader and runtime-oriented. [Atomix](https://arxiv.org/abs/2602.14849)
- **Robust Agent Compensation (RAC): Teaching AI Agents to Compensate** (submitted May 5, 2026) proposes log-based compensation through agent-framework extension points, with a LangChain implementation. It focuses on recovery/compensation rather than the narrow lost-ack reconciliation claim. [RAC](https://arxiv.org/abs/2605.03409)
- **Cordon: Semantic Transactions for Tool-Using LLM Agents** (submitted June 16, 2026) proposes task-scoped semantic transactions with shadow state, effect outboxes, staged outward effects, authority, validation, and recovery metadata. It explicitly argues for a broader runtime containment boundary than per-call guardrails. [Cordon](https://arxiv.org/abs/2606.17573)
- **Mnemosyne: Agentic Transaction Processing for Validating and Repairing AI-generated Workflows** (submitted June 30, 2026) treats generated actions as untrusted proposals subject to deterministic admission and uses an append-only transition log, compensation, commitments, and bounded repair. [Mnemosyne](https://arxiv.org/abs/2607.00269)

Overlap is real: transactional semantics, effect logs, compensation, and recovery. WriteGuard's intended distinction is product shape and adoption boundary—a small action-level library emphasizing `UNKNOWN` reconciliation of already-externalized writes, usable under existing runtimes. Whether that distinction is valuable is a validation question, not a proven moat.

## Receipts, audit, and rewind projects

- [Agent Work Receipt](https://agentworkreceipt.com/) and [AgentTrail](https://agenttrail.aivoralabs.org/) center evidence/provenance or receipts around agent work. Public positioning overlaps with understandable execution evidence, but a receipt alone does not prevent a duplicate or reconcile downstream provider state.
- [Rubrik Agent Rewind](https://www.rubrik.com/products/agent-rewind) positions around monitoring, auditing, and undoing agent-driven changes. That is adjacent at the recovery/governance layer; WriteGuard's MVP acts before a retry and may escalate when undo is not safe.
- Temporal, Restate, and DBOS are also competitive substitutes when a team can implement the needed action semantics directly inside its chosen runtime.

No claim is made that these projects lack features beyond their public documentation. A real competitive evaluation needs hands-on prototypes and customer interviews.

## Where the MVP overlaps—and does not

| Capability | Existing home | WriteGuard MVP |
|---|---|---|
| Request idempotency | Provider APIs such as Stripe | Reuses it but keeps a longer-lived business operation identity |
| Durable retry/scheduling | Temporal, Restate, DBOS | Explicitly out of scope |
| Agent run/replay | LangGraph and agent SDKs | Callable from these runtimes |
| Effect classification hints | MCP annotations | Adds enforced local lifecycle and evidence requirements |
| Compensation/transaction runtimes | Sagas, RAC, Atomix, Cordon, Mnemosyne | Optional single-action hook only |
| Audit/receipts | Workflow histories and receipt products | One sanitized terminal execution receipt plus ordered events |
| Unknown-result reconciliation | Often custom provider logic | First-class mandatory path before retry |

## Unresolved research questions

1. Which provider APIs make absence authoritative, and after what consistency window?
2. Can action contracts standardize identity/reconciliation/verification without hiding dangerous provider differences?
3. Will developers accept `NEEDS_REVIEW` rather than automatic liveness?
4. Does the library reduce code after the first adapter, or just reorganize it?
5. Should reconciliation continue in-process, under the host durable runtime, or through a future service?
6. How do provider idempotency retention windows interact with application retention and operation-key reuse?
7. What minimum evidence should make a receipt portable or independently auditable?

The next evidence should come from a credentialed Stripe test run and one real application integration, not additional market-architecture prose.
