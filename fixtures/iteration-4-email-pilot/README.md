# Iteration 4 email external-consumer pilot

This clean consumer proves that WriteGuard verification is not refund-specific:

1. Install packed public WriteGuard packages.
2. Normalize a direct MCP email-delivery tool.
3. Use a deterministic recorded analysis fixture.
4. Explicitly approve tenantId plus messageId as the send identity.
5. Generate the wrapper, bundle, manifest, and failure test.
6. Add a separate deterministic simulated-email provider.
7. Run safe static verification and controlled compilation.
8. Explicitly opt in to generated-test execution.
9. Compare unsafe duplicate sends with guarded timeout and concurrency behavior.

The fixture sends no real email. Recipient, subject, and body values are checked for exclusion from the returned durable receipt representation. Passing simulation does not establish any real email provider's semantics, and the verification receipt must keep that level as not run.

The repository runs this fixture from a copied clean directory through the Iteration 4 pilot validator. See docs/ITERATION_4_PILOT_RUNBOOK.md for the measured workflow.
