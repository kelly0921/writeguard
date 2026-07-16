# Pilot Quickstart

**Sandbox and design-partner evaluation only; not production-certified.**

## Prerequisites

- Node.js 20 or newer (the local baseline uses Node 24.17.0).
- pnpm 11.7.0 through Corepack.
- Docker Desktop or another Docker Compose-compatible engine.
- No provider credential for the default path.

## Credential-free validation

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm pilot:start
pnpm pilot:validate
pnpm writeguard:doctor
pnpm pilot:report
pnpm pilot:export
```

`pilot:start` creates an ignored `.env.pilot` from safe defaults when one does not exist. It starts PostgreSQL only on `127.0.0.1:54328`, applies the frozen public migrations, and creates the starter support-case table. `pilot:validate` resets the dedicated sandbox first, runs the fake acknowledgement-loss scenario, and prints sanitized results.

Inspect `.writeguard/pilot-report.md` and `.writeguard/pilot-export.json` locally before sharing. Nothing is uploaded automatically.

Clean up deterministically:

```powershell
pnpm pilot:reset
pnpm pilot:stop
```

## Shadow-to-enforced progression

The default `.env.pilot` uses `PILOT_MODE=shadow`. Shadow calls `observe`; the existing application remains responsible for executing the external action. WriteGuard records duplicate invocations and reconciliation classifications but does not execute or suppress anything.

Start an external integration with [the shadow template](../examples/pilot-shadow.ts). After the operation key, reconciliation lookup, verification hook, telemetry, and rollback procedure are reviewed, change the sandbox setting to:

```dotenv
PILOT_MODE=enforced
```

Then run:

```powershell
pnpm pilot:reset
pnpm pilot:validate
pnpm writeguard:doctor
```

Use [the enforced refund template](../examples/pilot-enforced-refund.ts) only for the approved sandbox workflow. The template imports only `@closure/writeguard` public exports.

## Optional Stripe test mode

Rotate any previously shared test credential before use. Add a current `sk_test_` credential only to ignored `.env.pilot`, set `PILOT_MODE=enforced` and `PILOT_PROVIDER=stripe-test`, then run `pnpm pilot:validate`. A live `sk_live_` credential is rejected before Stripe initialization. The command never prints the credential and does not store it in telemetry.

Stripe validation creates or reuses a test PaymentIntent and creates a test refund, so it is opt-in and not part of CI. Leave `PILOT_PROVIDER=fake` for the ordinary readiness path.

## Expected default result

In shadow mode, two uncontrolled retries produce two fake effects and WriteGuard reports `ambiguous_matches` without suppressing either. In enforced mode, the first acknowledgement loss becomes `UNKNOWN`; the retry reconciles to one fake effect and a verified `CONFIRMED` receipt.
