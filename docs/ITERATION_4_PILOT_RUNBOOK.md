# Iteration 4 external-consumer pilot runbook

## Purpose

Measure the complete normalize, recorded-analysis, review, approval, generation, provider-integration, verification, and simulated-failure journey without confusing automation speed with developer onboarding time.

The required pilots use self-contained simulated providers. They make no OpenAI or provider network calls and do not require API keys.

## Automated clean-consumer gate

From the repository root, run:

    pnpm validate:iteration-4-pilots

The validator:

1. Builds and packs @closure/writeguard and @closure/writeguard-generator.
2. Copies each fixture to a new temporary directory.
3. Rejects workspace aliases, private-source imports, and credential-shaped fixture values.
4. Installs only the packed packages with lifecycle scripts disabled.
5. Runs deterministic normalization, recorded analysis, explicit approval, and generation.
6. Runs packaged static verification with a separate provider implementation.
7. Runs packaged verification again with explicit generated-test execution.
8. Compiles the pilot through its own clean consumer configuration.
9. Runs three pilot-specific tests.
10. Writes sanitized receipts and an aggregate timing report under the ignored .writeguard directory.

After dependencies are installed, the pilot journey is offline. The generated-test verifier never reads or invokes target package scripts.

## Timing classifications

Record each category separately:

| Measurement | Method | Current status |
|---|---|---|
| Automated execution time | Duration measured by the repeatable validator | Measured on each run; not onboarding time |
| Maintainer clean-room time | A WriteGuard maintainer follows the commands manually from a copied fixture with a stopwatch | Pending manual measurement |
| External-developer time | A new developer follows this runbook without direct assistance | Pending an external pilot |

Do not claim the under-ten-minute customer outcome from automated duration alone.

## Maintainer clean-room measurement

1. Start with a clean clone or copied repository at the Iteration 4 checkpoint.
2. Confirm no WriteGuard environment variables or provider credentials are present.
3. Start a stopwatch before reading the selected pilot README.
4. Pack the core and generator packages.
5. Copy one pilot fixture outside the workspace.
6. Install the two tarballs with lifecycle scripts disabled.
7. Run the fixture setup.
8. Run packaged static verification.
9. Review the receipt and explain each verification level aloud or in notes.
10. Run verification with explicit generated-test execution.
11. Run the pilot-specific TypeScript build and tests.
12. Stop the stopwatch after correctly stating what remains unverified.

Record confusion and pauses. Do not subtract reading, review editing, or receipt interpretation time.

## External-developer measurement

Give the developer only:

- the packed packages or installation instructions;
- one pilot directory;
- its README;
- the verification contract.

Do not guide them during the timed attempt. Afterward, collect the feedback template in ITERATION_4_FEEDBACK_TEMPLATE.md. Mark the result incomplete if the developer cannot distinguish recommendation, approval, generation, simulated verification, and real-provider validation.

## Expected receipt interpretation

A successful current pilot receipt is passed with limitations:

- artifact integrity: passed, or passed with limitations when the explicit provider file is reported as extra;
- compilation: passed;
- simulated failure behavior: not run in static mode and passed with limitations after explicit opt-in;
- provider integration completeness: passed with limitations;
- real-provider semantics: not run.

Hashes prove integrity and binding, not authenticity. Child-process test execution is not a security sandbox. Simulation never establishes real-provider behavior.
