# External Pilot Runbook

**Sandbox and design-partner evaluation only; not production-certified.**

## Before onboarding

1. Run `pnpm validate:pilot-ready` on the exact candidate commit.
2. Review the design-partner questionnaire and confirm one narrow write workflow, a durable business-operation key, provider reconciliation lookup, postcondition verification, and a named rollback owner.
3. Require test or fake provider credentials only. Never request a credential in chat, email, an issue, telemetry, or a feedback form.
4. Agree on the observation window, support channel, retention expectation, and sanitized-export review owner.
5. Record that external validation is unproven until the partner completes the agreed steps.

## Integration sequence

1. Partner runs the credential-free quickstart and `writeguard:doctor`.
2. Partner copies the shadow template beside the existing external-write path.
3. Partner demonstrates that shadow observation neither executes nor suppresses a write.
4. Partner maps a stable business intention to one operation key; framework retry IDs remain invocation metadata only.
5. Partner implements reconciliation and verification against provider-visible state.
6. Team observes the narrow workflow for the agreed sample and reviews aggregate telemetry weekly.
7. Only after a written review, partner opts one sandbox workflow into enforced mode.
8. Partner deliberately tests acknowledgement loss, retry, reconciliation, and rollback.

## Daily checks during an active pilot

- Run `pnpm writeguard:doctor` after environment, dependency, or database changes.
- Review storage errors, UNKNOWN outcomes, ambiguous reconciliation, and `NEEDS_REVIEW` counts.
- Investigate every storage error and every `NEEDS_REVIEW`; do not retry an uncertain external write manually.
- Keep raw database access restricted to the pilot team. Use `pilot:export` for sharing aggregates.
- Confirm shadow code still calls `observe` and the application—not WriteGuard—executes the write.

## Weekly review

Use `docs/pilot-feedback/WEEKLY_REVIEW.md`. Generate `pnpm pilot:report` and `pnpm pilot:export`, inspect both, and attach only the sanitized aggregate export if the partner approves. Record integration time, support touches, operation count, duplicate invocations, UNKNOWN outcomes, reconciliation quality, review burden, and whether the product solved a real problem.

## Incident procedure

1. Stop new calls for the affected operation class.
2. Preserve the PostgreSQL ledger and provider state; do not reset or delete UNKNOWN/RECONCILING/NEEDS_REVIEW records.
3. Identify the stable operation key internally without pasting it into a public issue.
4. Reconcile against the provider and verify the business postcondition before any retry.
5. Use the reliability-incident template with sanitized counts and timestamps.
6. Follow `PILOT_ROLLBACK.md`. Escalate a suspected vulnerability through `SECURITY.md` privately.

## End of pilot

Run the decision-report process with actual evidence. State the number and identity class of participating teams, what they completed, and what remains unverified. Never convert a local test, founder-operated walkthrough, or planned conversation into an external adoption claim.
