# `@closure/writeguard-generator`

Optional design-time generation for WriteGuard. The package accepts only a validated normalized tool, its bound recommendation-only analysis, and a separately attested `writeguard.generation/v1` review.

Generation is deterministic and network-free. It emits a typed wrapper, developer-supplied provider boundary, configuration, executable simulated-provider failure tests, and a content-digested manifest. It never calls a model and generated runtime code has no OpenAI dependency.

Publishing is staged and refuses existing output paths, unsafe artifact paths, schema references, prototype-pollution-shaped properties, and symlink traversal. Real provider execution, reconciliation, verification, and durable production storage remain developer responsibilities.

```ts
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
const project = generateGuardedToolProject(request); // no filesystem write
await publishGeneratedProject(project, { outDir: "generated/refund" });
```

The result manifest is available before publication. Identical requests produce byte-identical files. Direct object and array schemas are supported up to eight generated type levels and 256 properties; `$ref`, `$defs`, `definitions`, `oneOf`, `anyOf`, and `allOf` are rejected. Generated tests cover only approved supported scenarios and clearly identify the simulated-provider limitation.
