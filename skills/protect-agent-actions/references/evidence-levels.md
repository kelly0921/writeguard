# WriteGuard evidence levels

Use these levels when interpreting a receipt:

1. **Artifact integrity** confirms that the manifest, inventory, versions, digests, paths, and source/analysis/review/generator bindings match. Digests establish integrity and binding, not authorship or authenticity.
2. **Compilation** confirms that generated TypeScript is type-correct against supported public package surfaces under verifier-controlled compiler settings. It does not prove provider behavior.
3. **Simulated failure behavior** confirms only the declared retry, duplicate, concurrency, crash, and reconciliation behavior exercised by deterministic generated tests.
4. **Provider integration completeness** reports whether application-owned executor, reconciliation, and verification hooks are implemented or remain scaffolds.
5. **Real-provider semantics** is verified only when a provider-specific conformance workflow actually ran in the labeled environment. Otherwise preserve `not_run` or the receipt's explicit limitation.

Interpret statuses literally:

- `passed`: every required check for the stated level passed.
- `failed`: at least one required check failed.
- `passed_with_limitations`: required checks passed, but explicitly listed evidence remains absent or bounded.
- `not_run`: the check did not execute; preserve the reason.
- `not_applicable`: the check does not apply to this action or mode.

Never merge these levels into one generic safety claim.
