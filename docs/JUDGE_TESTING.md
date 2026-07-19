# Judge testing instructions

These instructions target the owner-approved private evaluation repository at `https://github.com/kelly0921/writeguard`.

## Access

Private-repository testing access must be granted manually to:

- `testing@devpost.com`
- `build-week-event@openai.com`

Do not add either account without owner approval.

## Requirements

- Windows 11 or Ubuntu Linux
- Node.js 20 or newer; Node 24 is the validated version
- pnpm 11.9.0
- Network access for cloning and dependency installation
- No OpenAI key
- No Stripe key
- No PostgreSQL or Docker

If `pnpm` is unavailable:

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm --version
```

## Clone and evaluate

```powershell
git clone https://github.com/kelly0921/writeguard.git writeguard
cd writeguard
git checkout master
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm evaluate:local
```

At the Iteration 6A handoff, the remotely validated product commit is `5a0b5956a995cd7020fb4df880ad5d68a58eced7`. A later owner-approved documentation-only commit may advance `master` without changing the evaluated packages or runtime. Allow up to two minutes for the evaluation after installation; registry/cache conditions vary. This is automated execution time, not an onboarding claim.

Expected high-level output:

- unsafe simulated external effects: 2
- guarded simulated external effects: 1
- GPT-5.6 analysis: recorded fixture, recommendation-only, no live call
- developer approval: explicit and not inferred
- static verification: `passed_with_limitations`
- generated failure tests: `passed_with_limitations`
- adapter conformance: `passed`
- CI policy: `passed`
- real-provider semantics: `not_run`

Inspect:

```powershell
Get-Content .writeguard/evaluation-summary.md
Get-Content .writeguard/evaluation-report.json
Get-Content .writeguard/evaluation-static-verification.json
Get-Content .writeguard/evaluation-generated-test-verification.json
```

On Bash, use `cat` instead of `Get-Content`.

## Static versus executed verification

Static verification checks manifest-owned files, digests, provenance bindings, imports, credential patterns, the provider boundary, and controlled TypeScript compilation without executing generated JavaScript.

The canonical evaluator then separately opts into only the manifest-owned generated failure test. The equivalent CLI boundary for a retained generated project is:

```powershell
writeguard verify <generated-directory> --provider-file <reviewed-relative-provider-file> --strict --pretty
writeguard verify <generated-directory> --provider-file <reviewed-relative-provider-file> --strict --run-tests --pretty
```

`--run-tests` executes code in a bounded child process. It is not a security sandbox.

## What the result proves

- the packed packages can complete the documented public simulated journey;
- generated manifest-owned artifacts and provenance bindings match;
- generated TypeScript compiles against public package surfaces;
- five supported failure scenarios pass against the deterministic simulation;
- the public adapter contract passes six scenarios in the simulated environment;
- the named evaluation CI policy accepts the receipt and its declared limitations.

It does not prove:

- a live GPT-5.6 call occurred during the demo;
- Stripe, email, or another provider's real behavior;
- production safety or universal exactly-once execution;
- authenticity or authorship from SHA-256 digests;
- secure isolation of generated tests;
- durable deployment without reviewed provider hooks and PostgreSQL;
- the under-ten-minute external onboarding target.

Historical sanitized GPT-5.6 9/9 evidence and its provenance limitation are documented in `docs/BUILD_WEEK_ITERATION_2_VALIDATION.md` and `docs/BUILD_WEEK_ITERATION_5_VALIDATION.md`.

## Troubleshooting

- `pnpm` missing: activate pnpm 11.9.0 using Corepack as shown above.
- Install failure: confirm registry access and retry `pnpm install --frozen-lockfile`; do not remove the frozen-lockfile flag.
- Windows install warning about a missing pre-build `writeguard` bin: if installation exits zero, continue to `pnpm evaluate:local`, which builds the packages before invoking the CLI. Treat a nonzero install as a failure.
- Evaluation install timeout: confirm npm registry access. The evaluator installs packed packages into a fresh temporary consumer.
- Windows file-lock error: close editors/indexers touching the repository and rerun once. Do not disable integrity checks.
- Nonzero evaluation: retain sanitized `.writeguard/evaluation-*` artifacts and report the failing stage. Never attach environment files or credentials.
- Docker/PostgreSQL prompts: stop; neither is required for this path.

Remote evidence for product commit `5a0b5956a995cd7020fb4df880ad5d68a58eced7`:

- [Windows and Ubuntu evaluation run 29592547066](https://github.com/kelly0921/writeguard/actions/runs/29592547066): passed.
- [Ubuntu/PostgreSQL pilot run 29592547198](https://github.com/kelly0921/writeguard/actions/runs/29592547198): passed.
- A maintainer fresh clone from private `master` passed the commands above on Windows 11 with Node 24.17.0 and pnpm 11.9.0. The evaluator reported 88.773 seconds. This is not external-developer or onboarding-time evidence.
