# Distribution and Product Surfaces

Status: public-beta release contract

## Decision

WriteGuard is distributed first as an open-source TypeScript SDK and CLI. Provider contracts and conformance tests are the supported extension surface. An agent skill may guide integration, but deterministic runtime code and durable application-owned storage remain the enforcement boundary.

## Product layers

| Layer | Responsibility | Trust boundary |
|---|---|---|
| TypeScript SDK | Stable operation identity, durable claims, concurrency control, explicit uncertainty, reconciliation, verification, and receipts | Required runtime enforcement |
| CLI | Normalize, analyze, review, approve, generate, verify, inspect, and evaluate | Design-time and CI interface |
| Generator/verifier | Produce approved artifacts and independently verify integrity, compilation, and supported tests | Deterministic design-time tooling |
| Analyzer | Provide recommendation-only GPT analysis through a runtime-validated optional boundary | Untrusted recommendation evidence |
| Adapter conformance kit | Exercise declared provider behavior and label the evidence environment | Provider-owned implementation evidence |
| Agent skill | Guide a developer through the CLI and evidence model | Convenience only; no approval or enforcement authority |

## Current packages

- `@closure/writeguard@0.8.0`: unreleased external facade and `writeguard` CLI
- `@closure/writeguard-generator@0.3.1`: unreleased deterministic generator, verifier, policy evaluator, and report renderer
- `@closure/writeguard-analyzer-openai@0.1.1`: unreleased optional design-time analyzer

The private `@writeguard/core`, `@writeguard/sdk`, and `@writeguard/stripe-adapter` workspace packages are implementation and historical-demo boundaries. They are not supported external packages.

## Namespace decision

Do not rename packages or publish to npm until ownership of the intended registry namespace is verified. The `@closure/*` names remain stable inside the public beta source and evaluation artifacts so historical receipts, fixtures, and validation evidence stay reproducible.

Before the first registry release:

1. Verify control of the selected npm scope without assuming GitHub ownership implies registry ownership.
2. Choose the final names once, while all supported packages remain pre-1.0 and unpublished.
3. Rename the supported facade, analyzer, generator/verifier, generated imports, fixtures, scripts, and current documentation in one compatibility-tested change.
4. Preserve historical validation documents as historical evidence rather than rewriting their recorded package identities.
5. Pack and install every package in clean consumers before publication.

## Skill distribution

The repository-owned `skills/protect-agent-actions` skill packages the supported workflow for compatible coding agents. It must:

- inspect the actual tool and provider boundary;
- keep policy approval explicit;
- call the supported CLI rather than reimplementing contracts;
- run static verification before requesting opt-in test execution;
- preserve receipt limitations and evidence levels; and
- never request, print, recover, or store credentials.

A distributable plugin may later bundle the skill when install demand is demonstrated. A remote MCP server is deferred because it would introduce hosted trust, authentication, tenancy, retention, and execution questions that the local SDK does not require.

## Public repository boundary

The public repository includes source, migrations intended for consumers, tests, deterministic fixtures, documentation, sanitized evidence, and project media. It excludes credentials, local environment files, databases, generated evaluation output, package caches, private partner data, and unrelated projects. Both the working tree and every reachable Git commit must pass the credential-shape scans before visibility changes.

Public availability proves neither production readiness nor real-provider correctness. All external claims remain limited by the receipts and validation reports that support them.

## Commercial options

Only pursue hosted receipt operations, review queues, team policy, retention controls, enterprise governance, support, or certified adapters after independent users demonstrate repeated demand. Do not withhold the runtime failure semantics needed to evaluate and trust the core product.
