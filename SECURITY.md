# Security Policy

WriteGuard is available for sandbox and design-partner evaluation only; it is not production-certified.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, credential exposure, or exploit. Use the repository's private GitHub security-advisory flow (Security → Advisories → Report a vulnerability). If private reporting is unavailable, contact the maintainers through an established private channel before sending details.

Never include credentials, raw provider payloads, payment-instrument details, customer identifiers, operation keys, database dumps, or full tool inputs/outputs in a report. Share the smallest sanitized reproduction possible. Revoke or rotate any credential that may have been exposed before reporting it.

## Evaluation scope

The `@closure/writeguard` 0.3.x pilot baseline and unreleased 0.4.x Build Week line are currently in scope. There is no security SLA or production-support commitment. Maintainers will acknowledge valid private reports on a best-effort basis and coordinate disclosure only after a mitigation exists.

## Dependency and release hygiene

Before a pilot release, run `pnpm security:scan`, `pnpm audit --prod`, `pnpm security:sbom`, `pnpm package:inspect`, and `pnpm validate:pilot-ready`. Review lockfile changes, licenses, and transitive dependency changes. Apply dependency updates one at a time when practical, then re-run the complete readiness gate. Never weaken live-key rejection, reconciliation, fail-closed storage behavior, or export redaction to accommodate an update.
