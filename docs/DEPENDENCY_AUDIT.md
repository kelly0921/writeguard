# Dependency and License Review

## Public runtime surface

`@closure/writeguard@0.3.0` has two direct runtime dependencies: `pg` for PostgreSQL connectivity and `zod` for validated SDK inputs. Both are required by the frozen package surface. Demo, test, build, Stripe, MCP, dotenv, and TypeScript packages remain outside the published runtime dependency list.

`pnpm security:sbom` creates an ignored CycloneDX 1.5 document at `.writeguard/writeguard-sbom.cdx.json`, including the reachable runtime dependency graph and declared license expressions. `pnpm package:inspect` independently confirms that source files, tests, environment files, internal migrations, and workspace packages are absent from the tarball.

## Review commands

```powershell
pnpm audit --prod
pnpm security:sbom
pnpm package:inspect
pnpm validate:pilot-ready
```

Record audit date, package-manager result, exceptions, and remediation in `docs/MILESTONE_4_VALIDATION.md`. A clean audit means only that the selected advisory database reported no known vulnerabilities at that time; it is not a security certification.

## July 15, 2026 audit result

The first `pnpm audit --prod` found one high-severity advisory against `drizzle-orm` below 0.45.2 (GHSA-gpj5-g38j-94v9). Drizzle is used for the private schema definition; the correctness-critical ledger path uses explicit parameterized PostgreSQL transactions, and Drizzle is not in the published `@closure/writeguard` runtime graph. The known advisory was still treated as a pilot-release blocker.

The workspace constraint was narrowly updated from `^0.44.0` to `^0.45.2`, resolving to 0.45.2. No state-machine, SQL migration, public API, or package-runtime dependency changed. The follow-up `pnpm audit --prod` reported `No known vulnerabilities found`. This is a time-bound advisory-database result, not a security certification. The complete readiness suite must remain green before the dependency exception is accepted.

## August 27, 2026 MCP dependency remediation

A current `pnpm audit --prod --json` confirmed the previously documented Windows path-traversal advisory in `@hono/node-server@1.19.14` (`GHSA-frvp-7c67-39w9`) and newly disclosed advisories in the same MCP dependency paths through `hono@4.12.30`, `fast-uri@3.1.3`, and `ip-address@10.2.0`.

The lockfile was narrowly advanced to patched versions already permitted by `@modelcontextprotocol/sdk@1.29.0`:

- `@hono/node-server@1.19.15`
- `hono@4.12.34`
- `fast-uri@3.1.5`
- `ip-address@10.3.1`

No WriteGuard source code, public contract, direct dependency range, runtime state-machine behavior, or provider semantic claim changed. A follow-up audit reported no remaining advisory path through either `apps/agent-demo` or `apps/design-partner-starter`.

The remediation was independently applied to a clean WriteGuard checkout. `pnpm install --frozen-lockfile --ignore-scripts` passed, all three public packages built, all 172 unit tests passed, an isolated MCP client/server round-trip passed with the patched dependency graph, and `pnpm evaluate:local` passed in 42.7 seconds. The full PostgreSQL pilot-readiness gate was not rerun in that maintenance pass.

## License policy

Review every SBOM component before distribution. Escalate missing/unknown licenses, copyleft obligations, non-standard terms, or a package whose published license differs from its repository. Keep notices required by dependencies. Do not infer legal approval from an SPDX string; obtain counsel for uncertainty.

## Update policy

Prefer narrow, reviewable dependency updates. Inspect manifest and lockfile diffs, regenerate the SBOM, rerun audit and tarball inspection, then run the full readiness gate. Do not combine dependency churn with core state-machine changes during a pilot unless a confirmed security or reliability blocker requires it.
