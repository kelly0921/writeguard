# Build Week submission evidence

This is a local evidence index for later owner-written submission materials. It is not a submission and not proof of publication.

## What existed before Build Week

The local 0.3.0 baseline already had stable business-operation identity, PostgreSQL claims and recovery, explicit `UNKNOWN`, reconciliation, verification, execution receipts, shadow observation, a fake provider, a Stripe test-mode adapter, MCP/design-partner examples, local pilot telemetry, public package artifacts, and adapter tests. The verified pre-edit baseline had 26 unit and 20 integration tests. These capabilities must not be presented as Build Week inventions.

## What Iterations 1–5 added

- Iteration 1: versioned analysis contracts, deterministic MCP normalization, provenance/digests, injectable analyzer boundary, and analysis CLI/public export.
- Iteration 2: optional GPT-5.6 structured analysis, fail-closed model boundary, deterministic adversarial fixtures, and a sanitized live 9/9 evaluation.
- Iteration 3: explicit review/approve/generate contracts and CLI, deterministic typed wrappers, manifests, provider boundaries, and five generated failure scenarios.
- Iteration 4: safe-static and opt-in generated integration verification, controlled compilation/tests, deterministic receipts, and packed refund/email consumers.
- Iteration 5: one zero-credential evaluation, receipt-derived human summary, public conformance receipts, minimal CI policy, CI example, external tester materials, and release evidence.

## How Codex accelerated development

Codex acted as the implementation and validation agent across bounded iterations: it audited the existing architecture, extended public contracts rather than replacing them, generated code/tests/docs, diagnosed transient Windows/OneDrive and dependency-install failures, ran clean package consumers and complete gates, and maintained local checkpoint evidence. This is a development-process claim; it does not imply autonomous product validation or substitute for external users.

## GPT-5.6's role

GPT-5.6 is an optional design-time analyzer. It returns structured, recommendation-only risk analysis. Trusted code attaches provenance, analyzer identity, and approval state, and a developer separately reviews and approves. No model participates in deterministic generation, verification, adapter conformance, policy evaluation, or runtime enforcement. The credential-gated live evaluation passed 9/9 sanitized fixtures. The canonical evaluation uses a validated recorded fixture and makes no live call; the exact raw historical live output was not retained.

## Technical evidence

- Canonical command: `pnpm evaluate:local`
- Clean consumer: packed `@closure/writeguard@0.8.0` and `@closure/writeguard-generator@0.3.0`; no workspace/private imports
- Core analyzer: `@closure/writeguard-analyzer-openai@0.1.1`
- Contracts: analysis, generation, verification, verification policy/evaluation, adapter conformance, and local evaluation are runtime validated and versioned
- Offline calls: OpenAI 0; Stripe 0; other providers 0; PostgreSQL not required
- Effect demonstration: unsafe simulated retry 2; guarded simulated execution 1
- Verification: artifact integrity/provenance and controlled compilation passed; generated tests passed with explicit simulation limitations
- Adapter conformance: 6/6 scenarios passed in the explicitly simulated environment
- Policy: evaluation-release-candidate requirements passed; real-provider semantics explicitly not required and remained `not_run`
- Repository tests: 171 unit plus 20 integration, 191 total
- Additional evaluation coverage: 5 generated failure scenarios and 6 adapter-conformance scenarios
- Final Iteration 5 gate: passed in 848.851 seconds
- Canonical internal automated runtime: 37.645 seconds; not onboarding time

## Design and product coherence

The journey is one sequence with explicit trust transitions:

`Tool → Analyze → Review → Approve → Generate → Verify → Integrate`

Recommendations cannot become approval, generation is deterministic, verification consumes bound artifacts, test execution is opt-in, and simulation never becomes real-provider evidence. The CLI, public APIs, CI policy, and human summary all consume the same versioned contracts.

## Potential impact

The demonstrated value is narrower and more credible than generic agent orchestration: a developer can give one consequential action stable identity, preserve uncertainty after a lost acknowledgement, reconcile before retry, verify the postcondition, and receive reviewable evidence. External-developer time savings and production duplicate prevention remain hypotheses until independent pilots.

## Novelty and differentiation

WriteGuard focuses on transactional uncertainty at the tool-execution boundary: business-operation identity is distinct from agent call identity; `UNKNOWN` is a first-class persisted state; provider reconciliation and postcondition verification precede a retry; and generated/CI evidence states its own limits. It is not a workflow engine, generic observability product, provider idempotency wrapper, or claim of universal exactly-once execution.

## Exact demo and validation commands

```powershell
pnpm install --frozen-lockfile
pnpm evaluate:local
pnpm validate:build-week-iteration-5
```

Optional later Stripe test mode requires the secure environment-variable procedure in `docs/EVALUATION_RUNBOOK.md`; it is not part of the required evidence.

## Evidence status

| Claim | Evidence | Status |
|---|---|---|
| Deterministic unit coverage | `pnpm test:unit` | 171/171 passed |
| PostgreSQL/MCP/concurrency/pilot regression | `pnpm validate:build-week-iteration-4` | Passed in final gate |
| Live GPT-5.6 fixture quality | Sanitized `.writeguard/openai-live-evaluation.json` | Historical 9/9 pass reused; exact raw payload not retained |
| Clean packed-package evaluation | `pnpm evaluate:local` | Passed locally on Windows |
| Ubuntu/Windows CI example | `.github/workflows/evaluation.yml` | Structure validated locally; remote execution unverified |
| Stripe test-mode conformance | Optional secure runbook | Pending; no fresh key available |
| External-developer outcome | External evaluation record | Pending; zero external runs recorded |
| Publication, deployment, or submission | Owner-controlled external action | Not performed |

## Claims that must not be made

- production-safe, universally exactly once, or provider-certified;
- live GPT-5.6 analysis during the canonical evaluator;
- retained exact live payload provenance for the recorded fixture;
- real Stripe, email, or other provider semantics from simulation;
- secure sandboxing of generated code;
- digest authenticity, authorship, or trust;
- verified under-ten-minute external onboarding;
- remote CI success, public npm availability, deployment, or submission;
- external developer validation before two unaffiliated people complete it.

## Release blockers and asset checklist

- [x] Zero-credential evaluation command
- [x] Receipt-derived summary
- [x] Versioned CI receipt policy
- [x] Six-scenario adapter conformance receipt
- [x] External evaluator instructions and feedback questions
- [x] Local CI workflow example
- [ ] Owner-approved license
- [ ] Remote CI evidence
- [ ] Two external developer results, timing, and feedback
- [ ] Optional current Stripe test-mode conformance
- [ ] Submission copy, screenshots, or video approved by owner
