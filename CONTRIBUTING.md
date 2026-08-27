# Contributing to WriteGuard

WriteGuard welcomes focused issues and pull requests that strengthen the execution-safety thesis. The project is a public beta for sandbox and external evaluation; it is not production-certified.

## Development setup

Requirements: Node.js 20 or newer, pnpm 11.9.0, and Git. The credential-free path requires no API key, provider account, Docker, or PostgreSQL.

```powershell
pnpm install --frozen-lockfile
pnpm evaluate:local
```

Use `pnpm test:unit`, `pnpm typecheck`, and the narrowest relevant package build while iterating. Changes to PostgreSQL state, reconciliation, concurrency, migrations, packaging, or public contracts must also pass the complete pilot-ready validation documented in `BUILD_WEEK.md`.

## Contribution boundaries

- Keep models out of runtime enforcement.
- Preserve explicit developer approval and fail-closed uncertainty.
- Do not weaken identity, reconciliation, verification, redaction, digest, path, or test-execution checks.
- Add deterministic regression coverage for behavior changes.
- Do not claim real-provider semantics from simulations.
- Keep unrelated products, credentials, generated reports, databases, caches, and personal data outside this repository.
- Avoid broad adapter catalogs, dashboards, hosted services, or framework rewrites without external evidence of need.

## Pull requests

Describe the failure mode or user problem, the supported guarantee affected, tests run, receipt or migration compatibility, security/privacy impact, and known limitations. Keep changes reviewable and avoid mixing dependency churn with state-machine behavior when practical.

By contributing, you agree that your contribution is licensed under Apache License 2.0. No contributor license agreement is currently required.

## Security reports

Do not file public issues for vulnerabilities or credential exposure. Follow `SECURITY.md` and use GitHub's private security-advisory flow.
