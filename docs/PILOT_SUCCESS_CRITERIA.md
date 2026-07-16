# Pilot Success and Thesis Tests

External pilot evidence currently recorded: **0 teams, 0 external integrations, 0 external operations**. These thresholds define future decisions; they are not achieved claims.

## Strong signal

After at least two independent external teams complete a pilot, continue investing in the transactional-reliability wedge when all of the following are true:

- Both teams complete the credential-free sandbox and doctor without founder access to their machines.
- Median hands-on time to the first valid shadow observation is 60 minutes or less, excluding partner-specific provider API work.
- Each team observes at least 50 business operations over at least 5 calendar days.
- At least one team records a real retry/duplicate or UNKNOWN-outcome risk that mattered to its workflow.
- At least one team deliberately opts one sandbox workflow into enforced mode after shadow review.
- Every enforced UNKNOWN outcome is reconciled before retry; WriteGuard causes zero duplicate external effects in the observed enforced sample.
- Storage errors are 0; `NEEDS_REVIEW` plus ambiguous reconciliation is below 2% of observed guarded operations.
- Both teams say the receipt/reconciliation evidence is more useful than their previous retry/idempotency approach and request continued use.

## Mixed signal

Continue only with a narrowed hypothesis when integration works but one of these persists across two teams: 1–4 hours to first shadow observation, reconciliation support requires substantial custom work, no team opts into enforcement, or review burden is 2–10% of guarded operations. The next milestone must target the repeated friction—not add a dashboard or platform surface.

## Thesis-weakening signal

Pause or reframe the product when any of the following is true after two serious pilots:

- Neither team encounters a meaningful duplicate/UNKNOWN-outcome problem or values the evidence after the observation window.
- Median hands-on time to first shadow observation exceeds 4 hours after documentation fixes.
- Provider reconciliation cannot uniquely identify the external effect for the chosen workflows.
- More than 10% of guarded operations require manual review, or any WriteGuard-controlled retry creates a duplicate external effect.
- Storage/fail-closed behavior makes the guarded workflow less reliable than the partner's existing approach.
- Both teams stop after founder-led setup and will not maintain the integration themselves.
- The primary demand is for a generic workflow engine, dashboard, or payment orchestration product rather than transactional reliability for agent-triggered writes.

No single founder-operated demo can satisfy these thresholds. Record denominators, observation periods, and missing data with every percentage.
