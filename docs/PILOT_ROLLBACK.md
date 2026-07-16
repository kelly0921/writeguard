# Pilot Rollback

**Sandbox and design-partner evaluation only; not production-certified.**

## Shadow rollback

Shadow mode does not control the external write. Remove or disable the application call to `observe`, keep the application's original behavior unchanged, and retain the shadow ledger until the review owner confirms it can be deleted. No provider compensation is required merely because observation stops.

## Enforced rollback

1. Stop accepting new requests for the guarded operation.
2. Route future requests back to the previously reviewed application path only after its duplicate-risk behavior is explicitly accepted.
3. Do not delete the WriteGuard ledger or run `pilot:reset` while any operation is `UNKNOWN`, `RECONCILING`, or `NEEDS_REVIEW`.
4. Reconcile each uncertain operation against provider state and verify its postcondition.
5. Compensate only when the application has a tested, authorized compensation path and the receipt evidence justifies it.
6. Preserve sanitized incident evidence, then remove the guarded integration in a normal reviewed change.

Changing `PILOT_MODE` affects the supplied sandbox command; it does not automatically rewire a partner application's code path. The integration owner must make and review that routing change.

## Local sandbox cleanup

After all operations are terminal and evidence is retained:

```powershell
pnpm pilot:reset
pnpm pilot:stop
```

`pilot:reset` truncates only the configured local pilot database and removes local pilot telemetry/export/report files. `pilot:stop` removes the sandbox containers but retains the named Docker volume. Remove that volume only through an intentional, separately reviewed Docker operation.
