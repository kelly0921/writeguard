# Support Policy

**Sandbox and design-partner evaluation only; not production-certified.**

WriteGuard pilot support is best-effort and limited to the 0.3.x pilot baseline, unreleased 0.4.x/0.5.x Build Week lines, optional analyzer 0.1.x line, supplied PostgreSQL migrations, starter workflow, fake-provider sandbox, public templates, and documented Stripe test-mode path. There is no uptime, response-time, data-recovery, compatibility, model-quality, or production SLA.

Use the matching GitHub issue template for sanitized bugs, integration friction, adapter behavior, reconciliation behavior, or documentation gaps. Never include credentials, operation keys, provider payloads, payment details, customer identifiers, raw database rows, or full tool inputs/outputs. Suspected vulnerabilities must follow `SECURITY.md` and must not be filed publicly.

Support does not include custom provider implementation, production migration, incident command for live money movement, hosted infrastructure, data retention administration, or guarantees around an unvalidated runtime. A pilot may be paused when reconciliation or verification is incomplete, storage is unhealthy, rollback is unowned, or sensitive data cannot be handled safely.
