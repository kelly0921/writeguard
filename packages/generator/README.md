# @closure/writeguard-generator

Optional Node-only design-time generation and verification for WriteGuard. The package accepts a validated normalized tool, bound recommendation-only analysis, and separately attested writeguard.generation/v1 review.

Generation is deterministic and network-free. Version 0.3.0 emits a typed wrapper, provider boundary, configuration, simulated-provider failure tests, a writeguard-verification-bundle/v1 binding bundle, and a content-digested writeguard.generation-manifest/v1 manifest. It never calls a model and generated runtime code has no OpenAI dependency.

Programmatic generation:

    import { createGuardGenerationRequest } from "@closure/writeguard/analysis";
    import {
      generateGuardedToolProject,
      generatorDescriptor,
      publishGeneratedProject
    } from "@closure/writeguard-generator";

    const request = createGuardGenerationRequest({
      generator: generatorDescriptor,
      tool: normalizedTool,
      analysis,
      review: approvedReview
    });
    const project = generateGuardedToolProject(request);
    await publishGeneratedProject(project, { outDir: "generated/refund" });

Programmatic verification:

    import { verifyGeneratedIntegration } from "@closure/writeguard-generator";

    const staticRun = await verifyGeneratedIntegration({
      directory: "generated/refund",
      providerFile: "provider/simulated.ts"
    });

    const executedRun = await verifyGeneratedIntegration({
      directory: "generated/refund",
      providerFile: "provider/simulated.ts",
      runTests: true
    });

Safe static verification validates the manifest and bundle, path and symlink safety, bounded file inventory, digests and bindings, secret and import policy, provider-boundary shape, and controlled TypeScript compilation. It does not load target TypeScript configuration or plugins and does not run target scripts.

Generated-test execution is explicit. It rechecks integrity, compiles with fixed arguments into temporary verifier-owned output, runs only the manifest-owned generated failure test with the current Node executable, bounds time and output, minimizes inherited environment variables, and removes temporary output. This child process is not a security sandbox.

Every writeguard.verification/v1 receipt states what ran, what did not run, and why. Digests prove integrity and binding, not authenticity. Compilation and simulated providers never prove real-provider semantics.

Version 0.3.0 also exports:

- `writeguard.verification-policy/v1` and deterministic policy evaluation for named CI requirements;
- `writeguard.verification-policy-evaluation/v1` receipts with evidence identifiers, limitations, and next actions;
- `writeguard.local-evaluation/v1` reports and a deterministic Markdown renderer;
- parse and digest helpers for each contract.

The evaluation-release policy can explicitly accept declared simulation and extra-provider-file limitations while requiring manifest integrity, provenance, compilation, generated tests, a complete provider boundary, no OpenAI runtime dependency, and no credential-shaped output. A stricter policy can forbid limitations or require actual real-provider evidence. Policy evaluation consumes receipts and does not rerun code or make network calls.

Publishing refuses existing output paths, unsafe artifact paths, schema references, prototype-pollution-shaped properties, and symlink traversal. Direct object and array schemas are supported up to eight generated type levels and 256 properties; reference and composition schemas remain unsupported.
