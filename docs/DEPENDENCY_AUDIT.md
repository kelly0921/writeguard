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

## License policy

Review every SBOM component before distribution. Escalate missing/unknown licenses, copyleft obligations, non-standard terms, or a package whose published license differs from its repository. Keep notices required by dependencies. Do not infer legal approval from an SPDX string; obtain counsel for uncertainty.

## Update policy

Prefer narrow, reviewable dependency updates. Inspect manifest and lockfile diffs, regenerate the SBOM, rerun audit and tarball inspection, then run the full readiness gate. Do not combine dependency churn with core state-machine changes during a pilot unless a confirmed security or reliability blocker requires it.
