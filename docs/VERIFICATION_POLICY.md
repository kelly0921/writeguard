# Verification receipt policy

`writeguard.verification-policy/v1` is the minimal CI contract for deciding whether an existing `writeguard.verification/v1` receipt satisfies named project requirements. Policy evaluation is deterministic, network-free, and does not rerun verification.

```json
{
  "schemaVersion": "writeguard.verification-policy/v1",
  "kind": "writeguard_verification_policy",
  "name": "evaluation-release-candidate",
  "requirements": {
    "artifactIntegrity": "required",
    "provenanceBindings": "required",
    "controlledCompilation": "required",
    "generatedFailureTests": "required",
    "providerBoundaryComplete": "required",
    "noOpenAIRuntimeDependency": "required",
    "noSecretShapedValues": "required",
    "realProviderSemantics": "not_required",
    "receiptLimitations": "allow_declared"
  }
}
```

Run it against the complete JSON emitted by `writeguard verify`:

```powershell
writeguard policy check verification.json --policy writeguard.policy.json --pretty
```

The command emits `writeguard.verification-policy-evaluation/v1`. Exit code 0 means every required named dimension is satisfied. Exit code 7 means the policy is invalid, cannot be evaluated, or has at least one unsatisfied requirement. Verification itself continues to use exit code 6.

The evaluation-release policy deliberately accepts declared limitations and does not require real-provider semantics. It may therefore accept:

- manifest-owned integrity with a separately supplied provider file reported outside the manifest guarantee;
- successful simulated generated tests with their simulation limitation;
- a complete, type-compatible provider boundary while real-provider semantics remain unverified.

It never turns `passed_with_limitations` into an unexplained pass. The evaluation receipt retains the source receipt digest, every named requirement, evidence check identifiers, limitations, and next actions.

Stricter projects can set `receiptLimitations` to `forbid` or `realProviderSemantics` to `required`. The same simulated receipt then fails. A real-provider requirement is satisfied only when the source verification receipt actually reports the real-provider level as passed; a label, package name, or simulated test cannot substitute for that evidence.

Policies consume versioned receipts, not unstructured console text. They are intentionally small: arbitrary expressions, remote policy fetching, automatic approval, signature claims, and provider-specific semantics are outside this contract.
