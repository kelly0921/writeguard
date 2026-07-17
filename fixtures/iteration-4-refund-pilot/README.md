# Iteration 4 refund external-consumer pilot

This clean consumer proves the offline public-package journey for a consequential refund action:

1. Install packed @closure/writeguard and @closure/writeguard-generator tarballs.
2. Normalize a direct MCP refund tool.
3. Use a deterministic recorded analysis fixture.
4. Create and explicitly approve a review.
5. Generate the wrapper, bundle, manifest, and failure test.
6. Add a separate deterministic simulated-refund provider.
7. Run safe static verification.
8. Explicitly opt in to generated-test execution.
9. Compile and run the pilot-specific unsafe/guarded comparison.

The simulated provider is not Stripe and makes no network request. Its passing tests do not establish real-provider semantics. The generated verifier receipt must keep the real-provider level as not run.

The repository runs this fixture from a copied clean directory through the Iteration 4 pilot validator. See docs/ITERATION_4_PILOT_RUNBOOK.md for the measured workflow.
