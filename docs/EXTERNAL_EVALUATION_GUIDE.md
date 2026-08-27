# External evaluation guide

Thank you for testing WriteGuard. Please use a disposable clone and do not add real credentials or customer data.

## Access and requirements

- Public repository access: `https://github.com/kelly0921/writeguard`
- Git
- Node.js 20 or newer
- pnpm 11.9.0
- Windows, Ubuntu Linux, or another environment reported explicitly; macOS is not yet validated
- Network access for cloning and dependency installation
- No OpenAI key, Stripe key, PostgreSQL, Docker, or `.env` file

## First run

1. Start your timer, then create a disposable clone:

   ```powershell
   git clone https://github.com/kelly0921/writeguard.git writeguard-evaluation
   cd writeguard-evaluation
   git checkout master
   node --version
   pnpm --version
   ```

2. Run:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm evaluate:local
   ```

3. Read the terminal summary.
4. Inspect `.writeguard/evaluation-summary.md` and `.writeguard/evaluation-report.json`.
5. Inspect one second supplied consequential tool without implementation guidance:

   ```powershell
   pnpm writeguard normalize-mcp fixtures/mcp-tools/send-email.json --pretty
   ```

   Identify which fields appear sensitive and explain which later approval, generation, verification, and provider-integration steps have not occurred.
6. Stop. Do not attempt a real provider unless you have separately agreed on a test-only integration.

Completion means the evaluator ran successfully, you can identify what was and was not verified, and you inspected the supplied email tool without direct implementation help. The expected result shows two unsafe simulated effects, one guarded simulated effect, explicit developer approval, passing generated tests and adapter conformance, a passing evaluation policy, and real-provider semantics `not_run`.

## What we want to learn

Please record start and finish time and classify the run as `external-developer`. Do not include installation time from an unrelated toolchain setup unless that setup was required by this runbook.

Answer:

1. What is your development background and familiarity with agent tools, TypeScript, and provider integrations?
2. Did you complete the task? If not, where did you stop?
3. Where did you first become confused?
4. Which step took the longest?
5. Did the distinction between recommendation, approval, generation, verification, and integration make sense?
6. Could you explain the difference between simulated evidence and real-provider verification?
7. Did you trust the generated wrapper? Why or why not?
8. Could you explain what was verified and what remained unverified?
9. Did `passed_with_limitations` feel clear or misleading?
10. Which provider or action would you want to evaluate next?
11. Would you continue evaluating WriteGuard?
12. What were your start time, completion time, and elapsed minutes?
13. May the project use an anonymized quote or result from this evaluation? Answer yes or no.

Include operating system, Node version, pnpm version, command exit code, and sanitized error text if anything failed. Do not include credentials, payment references, customer details, full tool inputs, raw provider responses, absolute home-directory paths, or `.env` contents.

## Reporting a problem

Use the repository issue templates only after removing sensitive data. Security concerns follow `SECURITY.md` and must not be reported in a public issue. The project offers best-effort evaluation support and no production SLA.
