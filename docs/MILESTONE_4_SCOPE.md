# WriteGuard Milestone 4 Scope

## Outcome

Milestone 4 prepares the validated Milestone 3 system for external sandbox pilots and disciplined feedback collection. It does not claim that any outside team has installed or validated WriteGuard. External pilot results recorded at the start of this milestone: **0**.

The package boundary remains frozen at `@closure/writeguard@0.3.0`. Milestone 4 adds operational tooling around it: CI, a localhost pilot sandbox, validated settings, copyable examples, onboarding and rollback guidance, aggregate-only export, diagnostics, feedback templates, supply-chain artifacts, and a single readiness gate.

## In scope

- Re-run and preserve the full Milestone 3 evidence baseline.
- Prepare—but do not execute—the first external pilot workflow.
- Default to credential-free fake-provider and shadow-mode evaluation.
- Support an explicit, enforced Stripe test-mode path while rejecting live keys.
- Make shadow behavior non-enforcing and enforcement opt-in.
- Keep telemetry local, minimal, aggregateable, and non-critical.
- Give evaluators deterministic start, validate, diagnose, report, export, reset, and stop commands.
- Define measurable signals that would strengthen or weaken the adoption thesis.

## Frozen core

No Milestone 4 feature may change the state machine, operation identity rules, PostgreSQL ledger semantics, error taxonomy, public migrations, reconciliation behavior, receipt contract, or public export surface. A core change requires a concrete external-pilot blocker, a written decision record, and a versioned package change.

## Explicitly out of scope

- Production certification or a production rollout.
- A hosted control plane, dashboard, user accounts, authentication, billing, RBAC, webhooks, queues, analytics warehouse, or generic workflow engine.
- Additional payment providers or generalized adapter abstractions without pilot evidence.
- Automatic telemetry upload or remote database export.
- Retention automation; the configured retention value is a pilot policy input, not an automatic deletion guarantee.
- A management UI before the trigger criteria in `docs/UI_TRIGGER_CRITERIA.md` are met.

## Guardrail language

Every pilot-facing artifact must state: **Sandbox and design-partner evaluation only; not production-certified.** Internal validation may establish local readiness. Only named external evidence can establish external adoption or validation.
