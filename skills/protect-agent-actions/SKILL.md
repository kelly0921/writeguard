---
name: protect-agent-actions
description: Integrate WriteGuard into consequential TypeScript agent or MCP tools that create external effects. Use when adding retry safety, durable operation identity, UNKNOWN-outcome reconciliation, provider verification, generated wrappers, adapter conformance tests, or verification receipts to payment, messaging, provisioning, order, infrastructure, or other write operations.
---

# Protect Agent Actions

Guide a developer through WriteGuard's reviewable design-time workflow and deterministic runtime integration. Keep the developer in control of policy approval and provider semantics.

## Establish the boundary

1. Inspect the target tool, provider call, retry path, storage, and existing tests.
2. Confirm that the operation creates a consequential external effect. For a read-only tool, explain that WriteGuard execution protection is normally not needed.
3. Identify the stable business intention independently of framework run, message, or tool-call IDs.
4. Determine whether the provider supports idempotency, lookup/reconciliation, and postcondition verification. Never infer unsupported behavior.
5. Preserve existing user changes and avoid broad project rewrites.

If the repository contains WriteGuard product contracts, read `docs/TOOL_ANALYSIS_PRODUCT_CONTRACT.md`, `docs/VERIFICATION_PRODUCT_CONTRACT.md`, and `docs/ADAPTER_AUTHORING.md` before editing the integration.

## Select the command surface

- In the WriteGuard repository, use `pnpm writeguard`.
- In a consumer with the CLI installed, use `pnpm exec writeguard`.
- If neither command is available, stop and explain the missing installation rather than downloading or executing an unreviewed package automatically.

Keep JSON results on stdout and operational commentary on stderr. Write artifacts to explicit files when later steps require their digests.

## Follow the protected journey

1. Normalize the direct MCP-style tool definition:

   ```text
   <wg> normalize-mcp <tool.json> --pretty
   ```

2. Analyze only when the optional analyzer is installed and the developer explicitly wants a live model call. Read credentials from the environment; never request, echo, recover, store, or pass a key on the command line.

   ```text
   <wg> analyze <tool.json> --pretty
   ```

3. Create a draft review from the saved normalized tool and analysis artifacts:

   ```text
   <wg> review --tool <normalized.json> --analysis <analysis.json> --out <review.json> --pretty
   ```

4. Ask the developer to review operation identity, enforcement mode, reconciliation, verification, redaction, and failure scenarios. Do not approve on the developer's behalf.
5. After explicit approval, create the digest-bound approved review:

   ```text
   <wg> approve --tool <normalized.json> --analysis <analysis.json> --review <review.json> --reviewer <id> --out <approved.json> --pretty
   ```

6. Generate into a new directory. Refuse an existing output directory or any request to bypass provenance checks:

   ```text
   <wg> generate --tool <normalized.json> --analysis <analysis.json> --review <approved.json> --out-dir <generated-directory> --pretty
   ```

7. Implement the provider boundary with application-owned credentials and reviewed reconciliation and verification hooks.
8. Run safe static verification first:

   ```text
   <wg> verify <generated-directory> --provider-file <relative-provider-file> --strict --pretty
   ```

9. Explain that generated-test execution runs code and is not a security sandbox. Run it only after explicit approval:

   ```text
   <wg> verify <generated-directory> --provider-file <relative-provider-file> --strict --run-tests --pretty
   ```

10. Run the provider adapter conformance kit in a test or simulated environment. Label the evidence environment exactly.

## Preserve honest evidence

Read [references/evidence-levels.md](references/evidence-levels.md) before interpreting or summarizing a verification receipt.

- Do not describe simulated tests as real-provider verification.
- Do not describe compilation as provider correctness.
- Do not describe digests as authentication, authorship, or trust.
- Do not claim universal exactly-once execution or production safety.
- Keep real-provider semantics `not_run` unless a provider-specific conformance workflow actually ran.
- Preserve `UNKNOWN` or `NEEDS_REVIEW` when evidence is insufficient; never retry merely to make the workflow green.
- Scan generated artifacts and receipts for credentials and sensitive values before sharing them.

## Handoff

Report the selected operation identity, provider assumptions, executed checks, receipt status, limitations, unverified semantics, and exact next developer action. Separate automated runtime from human onboarding time.
