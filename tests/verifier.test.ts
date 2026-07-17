import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeMcpToolDefinition } from "@closure/writeguard/analysis";
import {
  generateGuardedToolProject,
  publishGeneratedProject,
  verifyGeneratedIntegration,
  type VerificationProcessRequest,
  type VerificationProcessResult,
  type VerificationProcessRunner
} from "@closure/writeguard-generator";
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };
import emailTool from "../fixtures/mcp-tools/send-email.json" with { type: "json" };
import { createApprovedGenerationFixture } from "./generation-fixtures.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function generatedDirectory(raw: unknown = refundTool): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "writeguard-verifier-"));
  roots.push(parent);
  await symlink(join(process.cwd(), "node_modules"), join(parent, "node_modules"), "junction");
  const target = join(parent, "generated");
  const tool = normalizeMcpToolDefinition(raw);
  const project = generateGuardedToolProject(createApprovedGenerationFixture(tool).request);
  await publishGeneratedProject(project, { outDir: target });
  return target;
}

async function manifest(root: string): Promise<any> {
  return JSON.parse(await readFile(join(root, "writeguard-generation.json"), "utf8"));
}

async function writeManifest(root: string, value: unknown): Promise<void> {
  await writeFile(join(root, "writeguard-generation.json"), JSON.stringify(value, null, 2) + "\n");
}

async function mutateOwnedFile(root: string, path: string, transform: (value: string) => string): Promise<void> {
  const filePath = join(root, ...path.split("/"));
  const next = transform(await readFile(filePath, "utf8"));
  await writeFile(filePath, next);
  const value = await manifest(root);
  const digest = createHash("sha256").update(next).digest("hex");
  value.files.find((file: any) => file.path === path).sha256 = digest;
  if (value.verificationBundle.path === path) value.verificationBundle.sha256 = digest;
  await writeManifest(root, value);
}

function diagnosticCode(receipt: Awaited<ReturnType<typeof verifyGeneratedIntegration>>["receipt"]): string | undefined {
  return receipt.checks.flatMap((check) => check.diagnostics).at(0)?.code;
}

class QueueRunner implements VerificationProcessRunner {
  readonly requests: VerificationProcessRequest[] = [];
  constructor(private readonly results: VerificationProcessResult[]) {}
  async run(request: VerificationProcessRequest): Promise<VerificationProcessResult> {
    this.requests.push(request);
    return this.results.shift() ?? { kind: "completed", exitCode: 0, stdout: "", stderr: "" };
  }
}

const passedProcess = (): VerificationProcessResult => ({
  kind: "completed",
  exitCode: 0,
  stdout: "",
  stderr: ""
});

describe("generated integration verifier", () => {
  it("passes valid artifact integrity and remains limited without real-provider evidence", async () => {
    const root = await generatedDirectory();
    const runner = new QueueRunner([passedProcess()]);
    const first = await verifyGeneratedIntegration({ directory: root }, { processRunner: runner });
    const second = await verifyGeneratedIntegration({ directory: root }, { processRunner: new QueueRunner([passedProcess()]) });
    expect(first.receipt.overallResult).toBe("passed_with_limitations");
    expect(first.receipt.levels).toContainEqual(expect.objectContaining({
      level: "artifact_integrity",
      status: "passed"
    }));
    expect(first.receipt.levels).toContainEqual(expect.objectContaining({
      level: "real_provider_semantics",
      status: "not_run"
    }));
    expect(first.receipt).toEqual(second.receipt);
    expect(first.receiptDigest).toBe(second.receiptDigest);
    expect(runner.requests).toHaveLength(1);
  });

  it.each([
    ["modified file", async (root: string) => writeFile(join(root, "src", "input.ts"), "modified\n"), "file_digest_mismatch"],
    ["missing file", async (root: string) => unlink(join(root, "src", "input.ts")), "file_missing"],
    ["incorrect digest", async (root: string) => {
      const value = await manifest(root);
      value.files.find((file: any) => file.path === "src/input.ts").sha256 = "0".repeat(64);
      await writeManifest(root, value);
    }, "file_digest_mismatch"],
    ["wrong source binding", async (root: string) => {
      const value = await manifest(root);
      value.sourceTool.sourceDigest = "0".repeat(64);
      await writeManifest(root, value);
    }, "source_binding_mismatch"],
    ["wrong analysis binding", async (root: string) => {
      const value = await manifest(root);
      value.analysis.digest = "0".repeat(64);
      await writeManifest(root, value);
    }, "analysis_binding_mismatch"],
    ["wrong review binding", async (root: string) => {
      const value = await manifest(root);
      value.developerReview.digest = "0".repeat(64);
      await writeManifest(root, value);
    }, "review_binding_mismatch"],
    ["unsupported generator", async (root: string) => {
      const value = await manifest(root);
      value.generator.version = "9.0.0";
      await writeManifest(root, value);
    }, "generator_unsupported"]
  ])("rejects %s", async (_label, mutate, expectedCode) => {
    const root = await generatedDirectory();
    await mutate(root);
    const runner = new QueueRunner([passedProcess()]);
    const result = await verifyGeneratedIntegration({ directory: root }, { processRunner: runner });
    expect(result.receipt.overallResult).toBe("failed");
    expect(diagnosticCode(result.receipt)).toBe(expectedCode);
    expect(runner.requests).toHaveLength(0);
  });

  it("rejects an unapproved review inside a digest-consistent verification bundle", async () => {
    const root = await generatedDirectory();
    await mutateOwnedFile(root, "writeguard-verification-bundle.json", (content) => {
      const bundle = JSON.parse(content);
      bundle.review.state = "draft";
      delete bundle.review.developerAttestation;
      return JSON.stringify(bundle, null, 2) + "\n";
    });
    const result = await verifyGeneratedIntegration(
      { directory: root },
      { processRunner: new QueueRunner([]) }
    );
    expect(diagnosticCode(result.receipt)).toBe("binding_invalid");
  });

  it("allows and reports extra files, while strict mode rejects them", async () => {
    const root = await generatedDirectory();
    await writeFile(join(root, "notes.txt"), "user-owned\n");
    const allowed = await verifyGeneratedIntegration(
      { directory: root },
      { processRunner: new QueueRunner([passedProcess()]) }
    );
    expect(allowed.receipt.extraFiles).toEqual(["notes.txt"]);
    expect(allowed.receipt.checks).toContainEqual(expect.objectContaining({
      id: "artifact.extra_files",
      status: "passed_with_limitations"
    }));
    const strict = await verifyGeneratedIntegration(
      { directory: root, strict: true },
      { processRunner: new QueueRunner([passedProcess()]) }
    );
    expect(diagnosticCode(strict.receipt)).toBe("extra_files_strict");
  });

  it.each([
    ["path traversal", "../escape.ts", "unsafe_path"],
    ["absolute path", "C:/escape.ts", "unsafe_path"]
  ])("rejects %s in the manifest", async (_label, unsafePath, expectedCode) => {
    const root = await generatedDirectory();
    const value = await manifest(root);
    value.files[0].path = unsafePath;
    await writeManifest(root, value);
    const result = await verifyGeneratedIntegration(
      { directory: root },
      { processRunner: new QueueRunner([passedProcess()]) }
    );
    expect(diagnosticCode(result.receipt)).toBe(expectedCode);
  });

  it("rejects duplicate normalized paths and Windows case collisions", async () => {
    const duplicateRoot = await generatedDirectory();
    const duplicate = await manifest(duplicateRoot);
    duplicate.files.push({ ...duplicate.files[0] });
    await writeManifest(duplicateRoot, duplicate);
    expect(diagnosticCode((await verifyGeneratedIntegration(
      { directory: duplicateRoot },
      { processRunner: new QueueRunner([]) }
    )).receipt)).toBe("path_duplicate");

    const collisionRoot = await generatedDirectory();
    const collision = await manifest(collisionRoot);
    collision.files.push({ ...collision.files.find((file: any) => file.path === "src/input.ts"), path: "SRC/INPUT.TS" });
    await writeManifest(collisionRoot, collision);
    expect(diagnosticCode((await verifyGeneratedIntegration(
      { directory: collisionRoot },
      { processRunner: new QueueRunner([]) }
    )).receipt)).toBe("path_case_collision");
  });

  it("rejects a symlink replacing a generated file", async () => {
    const root = await generatedDirectory();
    const outside = join(root, "..", "outside-src");
    await mkdir(outside);
    await writeFile(join(outside, "input.ts"), "export {};\n");
    const owned = join(root, "src");
    await rm(owned, { recursive: true, force: true });
    await symlink(outside, owned, "junction");
    const result = await verifyGeneratedIntegration(
      { directory: root },
      { processRunner: new QueueRunner([]) }
    );
    expect(diagnosticCode(result.receipt)).toBe("inventory_symlink");
  });

  it.each([
    ["unresolved marker", (value: string) => value + "\n// {{WRITEGUARD_VALUE}}\n", "unresolved_template"],
    ["OpenAI runtime import", (value: string) => value + "\nimport OpenAI from \"openai\";\n", "openai_runtime_dependency"],
    ["private WriteGuard import", (value: string) => value + "\nimport x from \"@closure/writeguard/src/internal\";\n", "private_writeguard_import"],
    ["credential-shaped value", (value: string) => value + "\n// " + "sk_" + "test_" + "A".repeat(20) + "\n", "secret_shaped_value"]
  ])("rejects %s even when the manifest digest was updated", async (_label, transform, expectedCode) => {
    const root = await generatedDirectory();
    await mutateOwnedFile(root, "src/input.ts", transform);
    const result = await verifyGeneratedIntegration(
      { directory: root },
      { processRunner: new QueueRunner([]) }
    );
    expect(diagnosticCode(result.receipt)).toBe(expectedCode);
  });

  it("rejects an oversized generated file", async () => {
    const root = await generatedDirectory();
    await mutateOwnedFile(root, "src/input.ts", (value) => value + "x".repeat(1024 * 1024));
    const result = await verifyGeneratedIntegration(
      { directory: root },
      { processRunner: new QueueRunner([]) }
    );
    expect(diagnosticCode(result.receipt)).toBe("file_oversized");
  });

  it.each([
    ["refund", refundTool],
    ["email", emailTool]
  ])("controlled compilation succeeds for a generated %s integration and ignores target tsconfig plugins", async (_label, raw) => {
    const root = await generatedDirectory(raw);
    await mutateOwnedFile(root, "tsconfig.json", () => JSON.stringify({
      compilerOptions: { plugins: [{ name: "untrusted-plugin-that-must-not-load" }] }
    }, null, 2) + "\n");
    const result = await verifyGeneratedIntegration({ directory: root });
    expect(result.receipt.checks).toContainEqual(expect.objectContaining({
      id: "compilation.public_surfaces",
      status: "passed"
    }));
  }, 30_000);

  it("fails controlled compilation for invalid public API usage", async () => {
    const root = await generatedDirectory();
    await mutateOwnedFile(
      root,
      "src/guarded-tool.ts",
      (content) => content + "\nimport { writeGuardApiThatDoesNotExist } from \"@closure/writeguard\";\n" +
        "void writeGuardApiThatDoesNotExist;\n"
    );
    const result = await verifyGeneratedIntegration({ directory: root });
    expect(result.receipt.overallResult).toBe("failed");
    expect(result.receipt.checks.find((check) => check.id === "compilation.public_surfaces")).toMatchObject({
      status: "failed"
    });
  }, 30_000);

  it("returns sanitized compilation failure, timeout, and output-limit receipts", async () => {
    const root = await generatedDirectory();
    const secret = "sk_" + "test_" + "B".repeat(20);
    const failed = await verifyGeneratedIntegration(
      { directory: root },
      { processRunner: new QueueRunner([{
        kind: "completed",
        exitCode: 2,
        stdout: "",
        stderr: root + " invalid " + secret
      }]) }
    );
    expect(failed.receipt.overallResult).toBe("failed");
    expect(JSON.stringify(failed.receipt)).not.toContain(root);
    expect(JSON.stringify(failed.receipt)).not.toContain(secret);
    expect(failed.receipt.checks.find((check) => check.id === "compilation.public_surfaces")
      ?.diagnostics[0]?.code).toBe("compilation_failed");

    for (const kind of ["timeout", "output_limit"] as const) {
      const result = await verifyGeneratedIntegration(
        { directory: root },
        { processRunner: new QueueRunner([{ kind, exitCode: null, stdout: "", stderr: "controlled" }]) }
      );
      expect(result.receipt.checks.find((check) => check.id === "compilation.public_surfaces")
        ?.diagnostics[0]?.code).toBe("compilation_" + kind);
    }
  });

  it("does not execute tests by default and excludes caller secrets from child environments", async () => {
    const root = await generatedDirectory();
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "not-inherited";
    try {
      const runner = new QueueRunner([passedProcess()]);
      const result = await verifyGeneratedIntegration({ directory: root }, { processRunner: runner });
      expect(result.receipt.checks).toContainEqual(expect.objectContaining({
        id: "tests.generated_failure_behavior",
        status: "not_run"
      }));
      expect(runner.requests).toHaveLength(1);
      expect(runner.requests[0]?.env.OPENAI_API_KEY).toBe("");
      expect(runner.requests[0]?.env.NODE_OPTIONS).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it("prevents all process execution after integrity failure", async () => {
    const root = await generatedDirectory();
    await writeFile(join(root, "src", "input.ts"), "tampered\n");
    const runner = new QueueRunner([passedProcess()]);
    const result = await verifyGeneratedIntegration({ directory: root, runTests: true }, { processRunner: runner });
    expect(result.receipt.overallResult).toBe("failed");
    expect(runner.requests).toHaveLength(0);
  });

  it("runs controlled generated tests only after explicit opt-in", async () => {
    const root = await generatedDirectory();
    const result = await verifyGeneratedIntegration({ directory: root, runTests: true });
    expect(result.receipt.checks).toContainEqual(expect.objectContaining({
      id: "tests.generated_failure_behavior",
      status: "passed_with_limitations"
    }));
    expect(result.receipt.levels).toContainEqual(expect.objectContaining({
      level: "real_provider_semantics",
      status: "not_run"
    }));
  }, 30_000);

  it("ignores an arbitrary target package script and still runs only the fixed generated test", async () => {
    const root = await generatedDirectory();
    await mutateOwnedFile(root, "package.json", (content) => {
      const packageManifest = JSON.parse(content);
      packageManifest.scripts.test = "node -e \"process.exit(99)\"";
      packageManifest.scripts.postinstall = "node -e \"process.exit(98)\"";
      return JSON.stringify(packageManifest, null, 2) + "\n";
    });
    const result = await verifyGeneratedIntegration({ directory: root, runTests: true });
    expect(result.receipt.checks).toContainEqual(expect.objectContaining({
      id: "tests.generated_failure_behavior",
      status: "passed_with_limitations"
    }));
  }, 30_000);

  it("reports controlled generated-test timeout, output limit, and failure", async () => {
    const root = await generatedDirectory();
    for (const processResult of [
      { kind: "timeout" as const, exitCode: null, stdout: "", stderr: "hung" },
      { kind: "output_limit" as const, exitCode: null, stdout: "large", stderr: "" },
      { kind: "completed" as const, exitCode: 1, stdout: "", stderr: "failed" }
    ]) {
      const runner = new QueueRunner([passedProcess(), passedProcess(), processResult]);
      const result = await verifyGeneratedIntegration({ directory: root, runTests: true }, { processRunner: runner });
      expect(result.receipt.checks.find((check) => check.id === "tests.generated_failure_behavior")?.status).toBe("failed");
      expect(runner.requests).toHaveLength(3);
      expect(runner.requests[2]?.args[0]).toBe("--test");
    }
  });

  it("reports a separate provider implementation without executing unrelated files", async () => {
    const root = await generatedDirectory();
    await mkdir(join(root, "provider"));
    await writeFile(join(root, "provider", "simulated.ts"), [
      "import type { ProviderBoundary } from \"../src/provider.js\";",
      "import type { ToolInput } from \"../src/input.js\";",
      "export const provider: ProviderBoundary<{ id: string }> = {",
      "  async execute(_input: ToolInput, context) { return { id: context.operationKey }; },",
      "  async reconcile() { return { kind: \"not_found\", evidence: {} }; },",
      "  async verify() { return true; }",
      "};",
      ""
    ].join("\n"));
    await writeFile(join(root, "never-execute.js"), "throw new Error(\"must not run\");\n");
    const runner = new QueueRunner([passedProcess()]);
    const result = await verifyGeneratedIntegration(
      { directory: root, providerFile: "provider/simulated.ts" },
      { processRunner: runner }
    );
    expect(result.receipt.inputs.providerFileDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.checks).toContainEqual(expect.objectContaining({
      id: "provider.boundary",
      status: "passed_with_limitations"
    }));
    expect(runner.requests[0]?.args.join(" ")).toContain("provider");
    expect(runner.requests[0]?.args.join(" ")).not.toContain("never-execute.js");
  });
});
