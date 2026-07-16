# Release Checklist

## Current repository state

The repository has no commits and no tags; all project files are currently untracked. `.tmp/`, `.writeguard/`, `.env.pilot`, `node_modules/`, `dist/`, and generated `packages/writeguard/migrations/` are ignored. Do not interpret a successful local validation as a published release.

Before any `git add .`, inspect ignored artifacts and verify no credential file is being forced into the index:

```powershell
git status --short
git status --ignored --short .tmp .writeguard .env.pilot node_modules dist packages/writeguard/migrations
git check-ignore -v .tmp .writeguard .env.pilot packages/writeguard/migrations
pnpm security:scan
```

Never use `git add -f` for an environment file, telemetry file, readiness report, package-verification workspace, generated migration copy, or local database artifact.

## Milestone 3 baseline commit and tag

These are the exact owner commands for a saved, clean Milestone 3 snapshot—before Milestone 4 files are present:

```powershell
pnpm validate:design-partner
git status --short
git add .
git diff --cached --check
git commit -m "release: WriteGuard Milestone 3 design-partner baseline"
git tag -a writeguard-v0.3.0 -m "WriteGuard 0.3.0 design-partner baseline"
git show --stat --oneline writeguard-v0.3.0
```

Do **not** run those commands on the current Milestone 4 working tree if the intent is a pure Milestone 3 tag. Because no Milestone 3 commit was created before this work began, the owner must either recover that saved snapshot or choose to make the first commit a combined repository baseline. Do not backdate or mislabel a combined commit as a separately preserved Milestone 3 release.

## Milestone 4 readiness

```powershell
pnpm install --frozen-lockfile
pnpm validate:pilot-ready
pnpm audit --prod
git diff --check
git status --short
```

Confirm the readiness output says `externalPilotResults: 0` and `productionCertified: false`. Inspect `.writeguard/pilot-readiness.md`, `.writeguard/tarball-inspection.json`, `.writeguard/writeguard-sbom.cdx.json`, and `.writeguard/pilot-export.json` locally; these generated artifacts remain ignored.

## Owner-controlled publication

Only after reviewing the entire first-commit scope:

```powershell
git add .
git diff --cached --check
git diff --cached --stat
git commit -m "feat: prepare WriteGuard external pilot operations"
git tag -a writeguard-pilot-ops-v0.4.0 -m "WriteGuard Milestone 4 pilot operations"
```

Pushing a branch, tag, package, or CI workflow is a separate human action. Verify the remote and package registry destination before publishing. No command in the local readiness gate publishes or uploads anything.
