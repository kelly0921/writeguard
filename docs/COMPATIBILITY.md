# Compatibility

**Sandbox and design-partner evaluation only; not production-certified.**

| Surface | Validated baseline | Support statement |
|---|---|---|
| `@closure/writeguard` | 0.3.0 baseline; 0.4.0 checkpoint; 0.5.0 unreleased | Pilot package plus additive Build Week analysis contract and CLI surface |
| `@closure/writeguard-analyzer-openai` | 0.1.0 unreleased | Node-only, design-time GPT-5.6 integration; deterministic fake transport validated, live model quality pending |
| OpenAI JavaScript SDK | 6.47.0 | Optional analyzer package only; absent from the core production graph |
| Node.js | 24.17.0 | Package declares Node >=20; other supported Node majors still require CI evidence |
| Module system | ESM / NodeNext | CommonJS consumption is not currently validated |
| PostgreSQL | 16.14 | Only PostgreSQL 16 is validated for the pilot ledger |
| pnpm | 11.9.0 current; 11.7.0 Milestone 4 baseline | Repository development and frozen-lockfile CI |
| TypeScript | 5.9.3 | Declarations and strict repository typecheck validated |
| Vitest | 3.2.7 | Local validation harness |
| MCP SDK | 1.29.0 | Starter tool boundary validated locally |
| Stripe | Test mode only | Optional workspace pilot adapter; excluded from CI and not exported by the core package |
| Operating systems | Windows 11 local baseline; Ubuntu CI definition | Ubuntu is not claimed until the workflow runs successfully on GitHub |

The public package requires PostgreSQL for durable use. The exported in-memory storage is explicitly unsafe and is limited to examples/tests. Browser, edge-runtime, serverless multi-region, managed Postgres variants, CommonJS, and non-PostgreSQL databases are unvalidated.

Compatibility claims must come from a repeatable gate or a named external pilot result. Add matrix rows only after evidence exists.
