import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGuardGenerationRequest,
  normalizeMcpToolDefinition
} from "@closure/writeguard/analysis";
import {
  WriteGuardGeneratorError,
  generateGuardedToolProject,
  generatorDescriptor,
  publishGeneratedProject,
  sanitizeTypeScriptIdentifier
} from "@closure/writeguard-generator";
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };
import emailTool from "../fixtures/mcp-tools/send-email.json" with { type: "json" };
import missingIdentityTool from "../fixtures/analyzer-evals/missing-identity.json" with { type: "json" };
import {
  createApprovedGenerationFixture,
  createGenerationRiskAnalysis
} from "./generation-fixtures.js";
import { renameWithTransientRetry } from "../packages/generator/src/publish.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "writeguard-generator-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function artifactContent(project: ReturnType<typeof generateGuardedToolProject>, path: string): string {
  const value = project.files.find((file) => file.path === path)?.content;
  if (!value) throw new Error(`Missing generated artifact ${path}`);
  return value;
}

describe("deterministic WriteGuard generator", () => {
  it("retries only bounded transient Windows publication failures", async () => {
    const attempts: string[] = [];
    const waits: number[] = [];
    await renameWithTransientRetry("stage", "target", {
      platform: "win32",
      renameOperation: async (stage, target) => {
        attempts.push(`${stage}:${target}`);
        if (attempts.length < 3) {
          throw Object.assign(new Error("transient filesystem lock"), { code: "EPERM" });
        }
      },
      targetState: async () => "missing",
      wait: async (milliseconds) => { waits.push(milliseconds); }
    });

    expect(attempts).toHaveLength(3);
    expect(waits).toEqual([10, 25]);

    await expect(renameWithTransientRetry("stage", "target", {
      platform: "linux",
      renameOperation: async () => {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      },
      targetState: async () => "missing",
      wait: async () => { throw new Error("must not wait"); }
    })).rejects.toMatchObject({ code: "EACCES" });
  });

  it.each([
    ["refund", refundTool, "RefundOrder"],
    ["email", emailTool, "SendCustomerEmail"]
  ])("generates a valid %s integration from approved public contracts", (_label, raw, symbol) => {
    const tool = normalizeMcpToolDefinition(raw);
    const fixture = createApprovedGenerationFixture(tool);
    const project = generateGuardedToolProject(fixture.request);
    expect(project.manifest).toMatchObject({
      kind: "writeguard_generation_manifest",
      generatedSymbol: symbol,
      sourceTool: { provenance: tool.provenance },
      developerReview: { reviewId: fixture.review.reviewId }
    });
    expect(artifactContent(project, "src/guarded-tool.ts")).toContain(`create${symbol}GuardedTool`);
    expect(artifactContent(project, "src/provider.ts")).toContain("interface ProviderBoundary");
    const failureTest = artifactContent(project, "test/failure.test.ts");
    expect(failureTest).toContain("node:test");
    expect(failureTest).toContain("claimTtlMs: 30_000, waitTimeoutMs: 5_000");
  });

  it("produces byte-identical output and correct file-content digests", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const fixture = createApprovedGenerationFixture(tool);
    const first = generateGuardedToolProject(fixture.request);
    const second = generateGuardedToolProject(fixture.request);
    expect(first).toEqual(second);
    for (const file of first.files) {
      expect(createHash("sha256").update(file.content).digest("hex")).toBe(file.sha256);
    }
    for (const owned of first.manifest.files) {
      expect(first.files.find((file) => file.path === owned.path)?.sha256).toBe(owned.sha256);
    }
  });

  it("uses only public WriteGuard runtime APIs and has no OpenAI dependency or secret", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const project = generateGuardedToolProject(createApprovedGenerationFixture(tool).request);
    const all = project.files.map((file) => file.content).join("\n");
    expect(artifactContent(project, "src/guarded-tool.ts")).toContain("from \"@closure/writeguard\"");
    expect(all).not.toContain("packages/core");
    expect(all).not.toContain("packages/sdk");
    expect(all).not.toMatch(/from ["']openai["']/);
    expect(all).not.toContain("OPENAI_API_KEY");
    expect(all).not.toMatch(/sk_(?:test|live|proj)_/);
  });

  it("requires explicit missing-identity resolution and emits the approved application hook", () => {
    const tool = normalizeMcpToolDefinition(missingIdentityTool);
    const analysis = createGenerationRiskAnalysis(tool, {
      identityStrategy: "application_supplied",
      identityFields: []
    });
    const fixture = createApprovedGenerationFixture(tool, analysis, { applicationSupplied: true });
    const project = generateGuardedToolProject(fixture.request);
    expect(artifactContent(project, "src/provider.ts")).toContain("getOperationKey(input: ToolInput): string");
    expect(artifactContent(project, "src/guarded-tool.ts")).toContain("provider.getOperationKey(input)");
  });

  it("refuses a failure scenario that has no supported generated test", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const analysis = createGenerationRiskAnalysis(tool, {
      failureScenarios: [{
        scenario: "verification_failure",
        expectedHandling: "require_review",
        reasoning: "The provider verification hook may fail."
      }]
    });
    const fixture = createApprovedGenerationFixture(tool, analysis);
    expect(() => generateGuardedToolProject(fixture.request)).toThrow(/unsupported generated failure scenarios/i);
  });

  it("binds requests to the exact generator identity and version", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const fixture = createApprovedGenerationFixture(tool);
    const request = createGuardGenerationRequest({
      generator: { ...generatorDescriptor, version: "9.9.9" },
      tool,
      analysis: fixture.analysis,
      review: fixture.review
    });
    expect(() => generateGuardedToolProject(request)).toThrow(WriteGuardGeneratorError);
  });

  it("sanitizes unsafe and reserved TypeScript identifiers without emitting descriptions as source", () => {
    expect(sanitizeTypeScriptIdentifier("class")).toBe("_Class");
    expect(sanitizeTypeScriptIdentifier("9-refund.tool")).toBe("_9RefundTool");
    const raw = structuredClone(refundTool) as any;
    raw.name = "class";
    raw.description = "*/ export const injected = process.env.SECRET; /*";
    const tool = normalizeMcpToolDefinition(raw);
    const project = generateGuardedToolProject(createApprovedGenerationFixture(tool).request);
    const guarded = artifactContent(project, "src/guarded-tool.ts");
    expect(guarded).toContain("create_ClassGuardedTool");
    expect(guarded).not.toContain("injected");
    expect(guarded).not.toContain("process.env.SECRET");
  });

  it("escapes provider hints as string literals instead of source", () => {
    const tool = normalizeMcpToolDefinition(refundTool);
    const analysis = structuredClone(createGenerationRiskAnalysis(tool));
    analysis.proposedGuardConfigurations[0]!.providerAdapter.providerHint = "provider\"; throw new Error(\"injected\") //";
    const fixture = createApprovedGenerationFixture(tool, analysis);
    const guarded = artifactContent(generateGuardedToolProject(fixture.request), "src/guarded-tool.ts");
    expect(guarded).toContain("provider: \"provider\\\"; throw new Error(\\\"injected\\\") //\"");
  });

  it("rejects prototype-pollution-shaped schemas and recursive schemas", () => {
    const prototypeRaw = JSON.parse(JSON.stringify(refundTool)) as any;
    prototypeRaw.inputSchema.properties = JSON.parse('{"__proto__":{"type":"string"}}');
    prototypeRaw.inputSchema.required = ["__proto__"];
    expect(() => normalizeMcpToolDefinition(prototypeRaw)).toThrow(/unsafe property name/i);

    const recursiveRaw = structuredClone(refundTool) as any;
    recursiveRaw.inputSchema.properties.orderId = { $ref: "#/definitions/orderId" };
    recursiveRaw.inputSchema.definitions = { orderId: { type: "string" } };
    const recursiveTool = normalizeMcpToolDefinition(recursiveRaw);
    expect(() => createApprovedGenerationFixture(recursiveTool)).toThrow(/reference-based/i);
  });

  it("publishes through a staged new directory and refuses unrelated existing files", async () => {
    const root = await temporaryRoot();
    const tool = normalizeMcpToolDefinition(refundTool);
    const project = generateGuardedToolProject(createApprovedGenerationFixture(tool).request);
    const published = await publishGeneratedProject(project, { outDir: join(root, "generated") });
    expect(published.files).toHaveLength(project.files.length);
    expect(JSON.parse(await readFile(join(root, "generated", "writeguard-generation.json"), "utf8")))
      .toMatchObject({ kind: "writeguard_generation_manifest" });

    const occupied = join(root, "occupied");
    await mkdir(occupied);
    await writeFile(join(occupied, "keep.txt"), "user-owned\n");
    await expect(publishGeneratedProject(project, { outDir: occupied })).rejects.toThrow(/already exists/i);
    expect(await readFile(join(occupied, "keep.txt"), "utf8")).toBe("user-owned\n");
  });

  it("rejects traversal and digest tampering without leaving partial output", async () => {
    const root = await temporaryRoot();
    const tool = normalizeMcpToolDefinition(refundTool);
    const project = generateGuardedToolProject(createApprovedGenerationFixture(tool).request);
    const traversing = structuredClone(project);
    traversing.files[0]!.path = "../escape.ts";
    await expect(publishGeneratedProject(traversing, { outDir: join(root, "traversal") }))
      .rejects.toThrow(/unsafe generated artifact path/i);

    const tampered = structuredClone(project);
    tampered.files[0]!.content += "tampered";
    await expect(publishGeneratedProject(tampered, { outDir: join(root, "tampered") }))
      .rejects.toThrow(/digest mismatch/i);
    await expect(readFile(join(root, "tampered", "README.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects symlink traversal where directory symlinks are supported", async () => {
    const root = await temporaryRoot();
    const real = join(root, "real");
    const link = join(root, "link");
    await mkdir(real);
    try {
      await symlink(real, link, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }
    const tool = normalizeMcpToolDefinition(refundTool);
    const project = generateGuardedToolProject(createApprovedGenerationFixture(tool).request);
    await expect(publishGeneratedProject(project, { outDir: join(link, "generated") }))
      .rejects.toThrow(/symlinked directory/i);
  });
});
