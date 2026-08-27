# External tester handoff

Status: ready-to-send instructions for two unaffiliated developers. Do not invent participants or results.

## Repository

Use the public repository:

`https://github.com/kelly0921/writeguard`

No GitHub invitation or established GitHub account is required for a public clone. Use a disposable clone. Do not add API keys, provider credentials, customer data, or a `.env` file.

## Environment

- Git
- Node.js 20 or newer
- pnpm 11.9.0
- Network access for clone and dependency installation
- Windows or Ubuntu preferred because both are validated; report any other platform
- No OpenAI account/key, Stripe account/key, Docker, or PostgreSQL

If pnpm is missing:

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
```

## Start and commands

Start your timer before the clone:

```powershell
git clone https://github.com/kelly0921/writeguard.git writeguard-evaluation
cd writeguard-evaluation
git checkout master
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm evaluate:local
Get-Content .writeguard/evaluation-summary.md
Get-Content .writeguard/evaluation-report.json
pnpm writeguard normalize-mcp fixtures/mcp-tools/send-email.json --pretty
```

On Bash, use `cat` instead of `Get-Content`.

## Definition of completion

Completion means:

1. The evaluation command reaches a terminal result, or you preserve the sanitized error that blocked it.
2. You can explain why the unsafe simulation reports two effects and the guarded simulation reports one.
3. You can identify what was verified and what remained unverified.
4. You can explain that the GPT-5.6 artifact was recorded/recommendation-only and that no live model call occurred.
5. You can explain why simulated evidence is not real-provider verification.
6. You inspect the supplied email tool, identify sensitive-looking fields, and identify which approval/generation/verification/integration steps have not run for that second tool.

Do not edit product code or connect a real provider.

## Timing

Record:

- start time and timezone;
- finish time and timezone;
- elapsed minutes;
- whether toolchain installation was already available;
- time spent on any required setup;
- any maintainer assistance received.

Classify the result as `external-developer`. Automated command runtime printed by WriteGuard is separate from your end-to-end time.

## Feedback questions

1. What is your background with agent tools, TypeScript, and provider integrations?
2. Did you complete the task? If not, where did you stop?
3. Where did you first become confused?
4. Which step took the longest?
5. Did recommendation, approval, generation, verification, and integration feel distinct?
6. Can you explain simulated evidence versus real-provider verification?
7. What do you believe WriteGuard verified?
8. What do you believe it did not verify?
9. Did `passed_with_limitations` feel clear or misleading?
10. Did you trust the generated wrapper, and why?
11. Which provider or action would you want next?
12. Would you continue evaluating WriteGuard?
13. May the project use an anonymized quote or result? Answer yes or no.

Also provide operating system, Node version, pnpm version, command exit codes, and sanitized error text if applicable. Use `docs/EXTERNAL_EVALUATION_RESULT_TEMPLATE.md`.

## Troubleshooting boundary

- Missing pnpm: use the Corepack commands above.
- Clone denied: stop and ask the owner for private read access.
- Install failure: confirm registry access and retry once with `pnpm install --frozen-lockfile`; do not remove the frozen-lockfile flag.
- Windows missing-bin warning with exit code zero: continue to the evaluator, which builds before using the CLI.
- Evaluation install timeout: confirm npm registry access and retry once.
- Nonzero evaluation: preserve only sanitized `.writeguard/evaluation-*` files and the failing stage.
- Any prompt for credentials, Docker, PostgreSQL, or a real provider: stop and report it.
- Security concern: follow `SECURITY.md`; do not post it publicly.

Maintainers may clarify access or environment setup. Any direct implementation guidance or command-by-command assistance must be recorded because it affects independence.
