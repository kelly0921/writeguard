# Security Policy

WriteGuard is available for sandbox and design-partner evaluation only; it is not production-certified.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, credential exposure, or exploit. Use the repository's private GitHub security-advisory flow (Security → Advisories → Report a vulnerability). If private reporting is unavailable, contact the maintainers through an established private channel before sending details.

Never include credentials, raw provider payloads, payment-instrument details, customer identifiers, operation keys, database dumps, or full tool inputs/outputs in a report. Share the smallest sanitized reproduction possible. Revoke or rotate any credential that may have been exposed before reporting it.

## Evaluation scope

The `@closure/writeguard` 0.3.x pilot baseline and unreleased 0.4.x–0.8.x lines, unreleased `@closure/writeguard-analyzer-openai` 0.1.x package, and unreleased `@closure/writeguard-generator` 0.1.x–0.3.x package are currently in scope. There is no security SLA or production-support commitment. Maintainers will acknowledge valid private reports on a best-effort basis and coordinate disclosure only after a mitigation exists.

## Dependency and release hygiene

Before a public or pilot release, run `pnpm security:scan`, `pnpm security:scan-history`, `pnpm audit --prod`, `pnpm security:sbom`, `pnpm package:inspect`, and `pnpm validate:pilot-ready`. The history scan covers reachable commits and reports only credential type, location, and a non-reversible fingerprint; it does not print a matched value. Review lockfile changes, licenses, and transitive dependency changes. Apply dependency updates one at a time when practical, then re-run the complete readiness gate. Never weaken live-key rejection, reconciliation, fail-closed storage behavior, or export redaction to accommodate an update.

The GPT-5.6 analyzer is design-time only. Never embed OpenAI keys or runtime/customer values in a tool definition. The full normalized definition is sent to OpenAI, so examples/defaults must be synthetic and metadata must be reviewed for personal or confidential data. The normalizer's credential-shape rejection and sensitive-field hints are defense-in-depth heuristics, not complete secret scanning or data-loss prevention. Analyzer errors and evaluation reports must not store raw prompts, responses, keys, or full sensitive inputs.

The generator is also design-time only and makes no model or network request. Treat tool metadata, schema keys, analysis text, and provider hints as untrusted input. Generation must remain approval-bound, deterministic, size-bounded, source-escaped, and restricted to constant relative artifact paths. It must refuse unsupported schema composition/references, prototype-pollution-shaped keys, existing output paths, symlink traversal, digest mismatch, or incomplete publication. Generated provider hooks and simulated tests are scaffolding, not proof of real provider behavior.

The generator verifier performs safe static checks by default. It rejects unsupported manifest, bundle, generator, and template versions; traversal; absolute, duplicate, or case-colliding paths; symlinks; oversized files; digest or provenance mismatch; unapproved review state; unresolved template markers; private WriteGuard imports; OpenAI runtime dependencies; and credential-shaped generated values. Controlled compilation uses fixed arguments and ignores target TypeScript configuration and plugins.

`writeguard verify --run-tests` is an explicit code-execution boundary. It runs only after integrity succeeds, compiles only manifest-owned generated TypeScript, invokes Node with fixed test arguments, applies timeout and output limits, removes temporary output, and minimizes inherited environment variables. It does not invoke npm, pnpm, lifecycle hooks, or target package scripts. It is not a security sandbox and does not claim network isolation. Use an isolated CI worker for defense in depth.

Verification digests prove integrity and binding, not authorship or authenticity. Passing compilation or simulated-provider tests does not establish real-provider idempotency, reconciliation, consistency, verification, or production safety.
