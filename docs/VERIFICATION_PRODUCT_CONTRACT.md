# WriteGuard Generated Integration Verification Contract

Status: supported design-time contract

## Meaning of verification

`writeguard verify` evaluates evidence about a generated integration. It does not certify the original inputs, provide a security sandbox, or prove a real provider's behavior.

Verification is reported at five independent levels:

1. **Artifact integrity** validates the generation manifest, generated-file inventory and SHA-256 digests, supported contract/generator/template versions, and the source, analysis, approved-review, and generator bindings carried in the verification bundle. Digests establish integrity and binding only. They do not establish authorship, authenticity, or trustworthiness of the original inputs.
2. **Compilation** typechecks generated TypeScript against supported public package exports through verifier-controlled compiler arguments. Target `tsconfig.json`, TypeScript plugins, and package scripts are not loaded. A pass establishes type compatibility, not provider correctness.
3. **Simulated failure behavior** executes only the manifest-owned generated failure test through fixed WriteGuard-controlled compiler and Node test-runner arguments. This level is `not_run` unless the caller explicitly opts in with `--run-tests`. The child process is constrained by timeout, output limits, and a minimal environment, but it is not a security sandbox.
4. **Provider integration completeness** reports the required `execute`, `reconcile`, and `verify` boundaries and whether a caller-identified provider implementation is present and typechecked. Static shape and compilation do not prove provider semantics.
5. **Real-provider semantics** is `not_run` by default and remains unverified unless a separately defined real-provider adapter conformance workflow actually runs. Simulated providers never satisfy this level.

## Stable receipt semantics

The verification contract version is `writeguard.verification/v1`. A receipt uses these statuses without collapsing skipped or limited evidence into success or failure:

- `passed`
- `failed`
- `passed_with_limitations`
- `not_run`
- `not_applicable`

The deterministic receipt payload contains verifier identity, mode, input digests, executed and skipped checks, level summaries, sanitized diagnostic codes/messages, limitations, next actions, and the overall result. It contains no timestamps or durations. Runtime timing may be returned separately and is excluded from receipt hashing.

Receipts are suitable for JSON CLI output, CI policy checks, a future UI, or a hosted service. Consumers must validate the contract before trusting its shape and must interpret `passed_with_limitations`, `not_run`, and `not_applicable` explicitly.

`writeguard.verification-policy/v1` can evaluate named receipt dimensions for CI without rerunning verification. The resulting `writeguard.verification-policy-evaluation/v1` artifact preserves the source receipt digest, each requirement and evidence identifier, limitations, and next actions. It does not treat a limited receipt as an unconditional pass and cannot replace missing real-provider evidence. See `docs/VERIFICATION_POLICY.md`.

For `writeguard verify`, exit code `0` means the command emitted a valid receipt whose overall result is `passed` or `passed_with_limitations`. Exit code `6` means a required verification check failed or the verifier could not produce a valid receipt. Fatal parsing and operational failures are written to stderr and do not emit partial JSON to stdout.

## Verification modes

### Safe/static mode (default)

Static mode validates the manifest and bundle, paths, symlinks, inventory, digests, sizes, bindings, imports, dependency declarations, secret patterns, unresolved template markers, provider boundary, and controlled TypeScript compilation. It never executes generated JavaScript, target package scripts, lifecycle scripts, or a target-provided TypeScript configuration.

Extra user-created files outside the generation manifest are allowed and reported. They do not affect generated-artifact integrity and are not executed. `--strict` rejects extras, except an explicitly supplied provider implementation file. Generated output under `dist`, `node_modules`, `.git`, and verifier-owned temporary directories is ignored by extra-file inventory.

### Generated-test mode (explicit opt-in)

`--run-tests` first requires successful artifact integrity and compilation. The verifier then compiles the manifest-owned generated source and test files with fixed arguments into a temporary directory inside the target, invokes the current Node executable with fixed `--test` arguments, and removes the temporary output. It does not read `scripts` from `package.json` or invoke npm/pnpm.

The process has a timeout, bounded output capture, and a minimal environment that excludes caller credentials and `NODE_OPTIONS`. Network isolation is not claimed. Integrity failure prevents all code execution.

## Binding bundle and provider evidence

Current generated projects contain a manifest-owned `writeguard-verification-bundle.json` with the normalized tool, analysis, and approved review needed to recompute the complete digest chain. The bundle can contain source descriptions and analysis reasoning; it must be handled as design-time project material even though WriteGuard normalization rejects credential-shaped values.

An optional provider implementation is identified explicitly with `--provider-file <relative-path>`. The file must remain inside the generated directory, cannot be a symlink, is scanned and included in controlled compilation, and is never executed by generated-test verification. Presence and type compatibility are evidence of integration completeness only.

## Required limitations

Every valid receipt states that:

- hashes do not prove authenticity;
- controlled child-process execution is not a security sandbox;
- compilation does not prove provider behavior;
- simulated failure tests do not prove real-provider semantics;
- durable PostgreSQL configuration and provider-specific conformance remain developer responsibilities.
