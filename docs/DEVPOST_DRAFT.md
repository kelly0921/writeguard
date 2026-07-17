# Devpost submission draft — owner review only

Status: draft only. Do not submit or publish from this document.

## Project

- Recommended name: WriteGuard
- Tagline: Transactional safety for consequential actions performed by AI agents.
- Category: Developer Tools
- Repository URL: pending owner-approved private repository
- Demo video URL: pending; no upload authorized

## Short description

WriteGuard gives consequential AI-agent tool calls stable business-operation identity, persists uncertain outcomes, reconciles before retry, verifies the provider result, and returns reviewable receipts. GPT-5.6 analyzes tools at design time; developers explicitly approve policy; deterministic code enforces at runtime.

## Problem

Agent frameworks often identify retries by transient tool-call IDs. If a provider commits a refund, email, deployment, or record mutation but the caller loses the acknowledgement, a second agent call can repeat the effect. Ordinary retry logic cannot safely distinguish “submission failed” from “submission succeeded but the response was lost.”

## Target audience

Agent-tool, MCP, backend, platform, reliability, and payments developers integrating consequential external writes.

## Product journey

`Tool → Analyze → Review → Approve → Generate → Verify → Integrate`

1. Normalize an MCP-style tool with deterministic provenance.
2. Use optional GPT-5.6 structured analysis to identify consequential effects and recommend identity, reconciliation, redaction, and failure behavior.
3. Review and explicitly approve; analysis cannot approve itself.
4. Deterministically generate a typed wrapper, provider boundary, manifest, and failure tests.
5. Verify integrity, provenance, public compilation, and opt-in simulated failure behavior.
6. Implement and validate the actual provider boundary with durable storage.

## Demonstration

```powershell
pnpm install --frozen-lockfile
pnpm evaluate:local
```

The zero-credential clean consumer observes two external effects from unsafe simulated retry and one effect from guarded execution. It passes five manifest-owned failure scenarios, six public adapter-conformance scenarios, and a versioned CI receipt policy. Real-provider semantics remain visibly `not_run`.

## Technical architecture

- `@closure/writeguard`: deterministic execution, PostgreSQL storage, explicit `UNKNOWN`, reconciliation, verification, receipts, analysis contracts, CLI, and public adapter testing.
- `@closure/writeguard-analyzer-openai`: optional Node-only GPT-5.6 Responses API structured analyzer.
- `@closure/writeguard-generator`: deterministic wrapper/test generation, verification, receipt policy, and report rendering.
- Trusted code attaches provenance and approval boundaries outside model output.
- Generated/runtime package paths contain no OpenAI dependency.
- Static verification executes no generated JavaScript; `--run-tests` is explicit and bounded.

## GPT-5.6 usage

GPT-5.6 is used only for design-time, recommendation-only tool-risk analysis. The credential-gated evaluation passed 9/9 sanitized fixtures. The canonical offline demo uses a recorded validated fixture, clearly states that no live call occurred, and does not retain the exact raw historical payload.

## Codex usage

Codex audited the existing architecture, implemented the versioned analysis/generation/verification/evaluation contracts and CLI workflows in bounded iterations, generated tests and documentation, diagnosed cross-platform validation failures, ran clean package consumers, and maintained reproducible local gates. Codex does not substitute for external users or real-provider validation.

## Pre-existing versus Build Week

Before Build Week, WriteGuard already had stable operation identity, PostgreSQL recovery, `UNKNOWN`, reconciliation, verification, receipts, shadow mode, a fake provider, a Stripe test-mode adapter, starter integrations, and 46 repository tests.

Iterations 1–5 added deterministic MCP normalization, GPT-5.6 structured analysis, explicit approval contracts, typed deterministic generation, independent generated-integration verification, packed refund/email pilots, the zero-credential evaluation, conformance receipts, and CI receipt policy. Iteration 6 validates access, CI, external learning, and submission materials without adding speculative product features.

## Verified metrics

- 2 unsafe simulated effects versus 1 guarded simulated effect
- 171 unit tests and 20 integration tests
- 5 generated failure scenarios
- 6 adapter-conformance scenarios
- 6 packed-pilot-specific tests
- historical sanitized GPT-5.6 evaluation: 9/9
- canonical evaluator: 0 OpenAI, Stripe, or other provider calls after clean-consumer installation
- local automated runtime observed between roughly 40 and 80 seconds; not onboarding time

## Trust and security boundaries

- GPT-5.6 proposes; it never approves or enforces.
- Developer approval is a separate digest-bound artifact.
- Runtime enforcement is deterministic.
- Provider truth remains application-owned.
- Digests establish integrity/binding, not authenticity.
- Simulations do not establish real-provider semantics.
- Generated test execution is not a security sandbox.
- Durable deployment requires PostgreSQL and reviewed provider hooks.

## Potential impact and differentiation

WriteGuard addresses transaction uncertainty rather than general orchestration: it distinguishes business-operation identity from agent-call identity, persists ambiguous outcomes, reconciles before retry, verifies postconditions, and makes evidence limitations machine-readable. The intended impact is less bespoke failure-handling and fewer accidental repeated effects; external time savings and production outcomes remain hypotheses until independent pilots.

## Claims pending Iteration 6 evidence

- Windows and Linux remote CI pass
- fresh private-repository clone pass
- two unaffiliated developer results and measured times
- any under-ten-minute onboarding result
- real Stripe test-mode conformance
- final repository URL

## Claims not to make

Do not say production-safe, universal exactly once, real-provider validated while Stripe is pending, securely sandboxed, live GPT-5.6 during the canonical demo, publicly published on npm, or externally validated beyond completed evidence.

## Required submission-field answers

- Built for: OpenAI Build Week
- Category: Developer Tools
- Technologies: TypeScript, Node.js, PostgreSQL, MCP, OpenAI Responses API, Zod, GitHub Actions
- AI models: GPT-5.6 for optional design-time structured analysis
- Source access: pending approved private repository and judge access
- License: none while private
- Submission/session evidence: primary `/feedback` Codex Session ID pending owner retrieval

## Screenshot recommendations

1. Terminal outcome showing 2 unsafe versus 1 guarded effect and recorded/no-live-call labels.
2. Receipt summary showing policy passed and real-provider semantics `not_run`.
3. Compact journey diagram or generated-file/verification evidence.

Do not show home-directory paths, environment variables, keys, provider references, or personal account information.

## Final owner checklist

- approve repository owner/name/visibility and push scope;
- grant private judge access;
- confirm Windows/Linux CI and fresh clone;
- collect two external evaluations;
- review P0/P1 resolution and supported claims;
- provide private `/feedback` Session ID;
- approve screenshots, thumbnail, recording, and video upload;
- insert final repository/video URLs;
- review Devpost fields;
- authorize project creation/submission separately.
