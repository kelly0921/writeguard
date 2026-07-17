# Evaluation release checklist

## Current state

Iteration 5 is an unreleased local evaluation candidate. Build Week checkpoints exist through Iteration 4; nothing in the Iteration 5 workflow pushes, publishes, deploys, uploads, or submits.

The canonical pre-release gate is:

```powershell
docker compose up -d postgres
pnpm validate:build-week-iteration-5
docker compose stop postgres
git diff --check
git status --short
```

The gate clears OpenAI and Stripe keys for required commands, reuses only the sanitized historical 9/9 live evaluation report, exercises the complete inherited PostgreSQL regression suite, runs the packed zero-credential evaluation, validates the CI example and docs, and finishes with a secret scan. PostgreSQL started solely for validation must be stopped afterward.

## Evidence review

Before a local checkpoint:

```powershell
pnpm security:scan
git status --short
git diff --check
git diff --stat
```

Review `.writeguard/build-week-iteration-5.json`, `.writeguard/evaluation-report.json`, `.writeguard/evaluation-summary.md`, `docs/BUILD_WEEK_ITERATION_5_VALIDATION.md`, and `docs/BUILD_WEEK_SUBMISSION_EVIDENCE.md`.

Generated `.writeguard` artifacts remain ignored. Never force-add environment files, credentials, local reports, package-verification workspaces, telemetry, or database artifacts.

## Mandatory owner decisions before public release

- Choose and approve a repository/package license. No license file currently exists; public distribution is blocked until this is resolved.
- Review remote repository and npm registry destinations.
- Decide whether the package names and pre-1.0 version line are final.
- Obtain remote Ubuntu/Windows CI evidence after pushing.
- Record at least one unassisted external-developer evaluation and timing.
- Decide whether optional current Stripe test-mode conformance is required for the release claim.
- Review submission copy, media, privacy statements, and all externally visible evidence.

## Local Iteration 5 checkpoint

Only after the complete gate passes:

```powershell
git add .
git diff --cached --check
git commit -m "build-week(iteration-5): prepare evaluation release candidate"
git tag -a build-week-iteration-5 -m "WriteGuard OpenAI Build Week Iteration 5"
```

Pushing the commit/tag, publishing packages, deploying software, opening a pull request, uploading assets, and submitting to Build Week are separate owner-controlled actions and are not authorized by this checklist.
