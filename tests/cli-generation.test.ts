import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeMcpToolDefinition } from "@closure/writeguard/analysis";
import { runWriteGuardCli, type WriteGuardCliIo } from "../packages/writeguard/src/cli-program.js";
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };
import { acknowledgeReview, createGenerationRiskAnalysis } from "./generation-fixtures.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "writeguard-cli-generation-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function capture() {
  let stdout = "";
  let stderr = "";
  const io: WriteGuardCliIo = {
    stdout: (message) => { stdout += message; },
    stderr: (message) => { stderr += message; },
    readStdin: async () => ""
  };
  return { io, output: () => ({ stdout, stderr }) };
}

async function writeInputs(root: string) {
  const tool = normalizeMcpToolDefinition(refundTool);
  const analysis = createGenerationRiskAnalysis(tool);
  const toolPath = join(root, "tool.json");
  const analysisPath = join(root, "analysis.json");
  await writeFile(toolPath, JSON.stringify(tool));
  await writeFile(analysisPath, JSON.stringify(analysis));
  return { tool, analysis, toolPath, analysisPath };
}

describe("WriteGuard review, approval, and generation CLI", () => {
  it("creates a separate editable draft without approving it", async () => {
    const root = await temporaryRoot();
    const inputs = await writeInputs(root);
    const reviewPath = join(root, "review.json");
    const captured = capture();
    expect(await runWriteGuardCli([
      "review",
      "--tool", inputs.toolPath,
      "--analysis", inputs.analysisPath,
      "--out", reviewPath,
      "--pretty"
    ], captured.io)).toBe(0);
    const review = JSON.parse(await readFile(reviewPath, "utf8"));
    expect(review).toMatchObject({
      kind: "guard_generation_review",
      state: "draft",
      selection: {
        guardConfiguration: { enforcementAcknowledged: false },
        reconciliation: { developerSuppliedHookAcknowledged: false }
      }
    });
    expect(review.developerAttestation).toBeUndefined();
    expect(JSON.parse(captured.output().stdout)).toMatchObject({ status: "draft_created" });
    expect(captured.output().stderr).toBe("");
  });

  it("rejects an incomplete approval nonzero without creating partial output", async () => {
    const root = await temporaryRoot();
    const inputs = await writeInputs(root);
    const reviewPath = join(root, "review.json");
    expect(await runWriteGuardCli([
      "review", "--tool", inputs.toolPath, "--analysis", inputs.analysisPath, "--out", reviewPath
    ], capture().io)).toBe(0);
    const approvedPath = join(root, "approved.json");
    const captured = capture();
    expect(await runWriteGuardCli([
      "approve",
      "--tool", inputs.toolPath,
      "--analysis", inputs.analysisPath,
      "--review", reviewPath,
      "--reviewer", "developer",
      "--out", approvedPath
    ], captured.io)).toBe(5);
    expect(captured.output().stdout).toBe("");
    expect(captured.output().stderr).toContain("explicitly acknowledge promotion");
    await expect(readFile(approvedPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("approves only an edited review with a non-secret attestation and timestamp", async () => {
    const root = await temporaryRoot();
    const inputs = await writeInputs(root);
    const draftPath = join(root, "draft.json");
    expect(await runWriteGuardCli([
      "review", "--tool", inputs.toolPath, "--analysis", inputs.analysisPath, "--out", draftPath
    ], capture().io)).toBe(0);
    const draft = JSON.parse(await readFile(draftPath, "utf8"));
    const editedPath = join(root, "edited.json");
    await writeFile(editedPath, JSON.stringify(acknowledgeReview(draft)));
    const approvedPath = join(root, "approved.json");
    const captured = capture();
    expect(await runWriteGuardCli([
      "approve",
      "--tool", inputs.toolPath,
      "--analysis", inputs.analysisPath,
      "--review", editedPath,
      "--reviewer", "developer@example.invalid",
      "--out", approvedPath,
      "--pretty"
    ], captured.io, {
      now: () => "2026-07-17T01:30:00.000Z"
    })).toBe(0);
    expect(JSON.parse(await readFile(approvedPath, "utf8"))).toMatchObject({
      state: "approved",
      developerAttestation: {
        reviewer: "developer@example.invalid",
        reviewedAt: "2026-07-17T01:30:00.000Z"
      }
    });
    expect(JSON.parse(captured.output().stdout)).toMatchObject({
      command: "approve",
      status: "approved_review_created"
    });
    expect(captured.output().stderr).toBe("");
  });

  it("has no hidden --yes approval path", async () => {
    const captured = capture();
    expect(await runWriteGuardCli(["approve", "--yes"], captured.io)).toBe(5);
    expect(captured.output().stdout).toBe("");
    expect(captured.output().stderr).toContain("unsupported argument --yes");
  });

  it("passes only bound artifacts to the optional generator and keeps stdout JSON-only", async () => {
    const root = await temporaryRoot();
    const inputs = await writeInputs(root);
    const draftPath = join(root, "draft.json");
    expect(await runWriteGuardCli([
      "review", "--tool", inputs.toolPath, "--analysis", inputs.analysisPath, "--out", draftPath
    ], capture().io)).toBe(0);
    const editedPath = join(root, "edited.json");
    await writeFile(
      editedPath,
      JSON.stringify(acknowledgeReview(JSON.parse(await readFile(draftPath, "utf8"))))
    );
    const approvedPath = join(root, "approved.json");
    expect(await runWriteGuardCli([
      "approve",
      "--tool", inputs.toolPath,
      "--analysis", inputs.analysisPath,
      "--review", editedPath,
      "--reviewer", "developer",
      "--reviewed-at", "2026-07-17T01:30:00.000Z",
      "--out", approvedPath
    ], capture().io)).toBe(0);
    const outputDir = join(root, "generated");
    let called = false;
    const captured = capture();
    expect(await runWriteGuardCli([
      "generate",
      "--tool", inputs.toolPath,
      "--analysis", inputs.analysisPath,
      "--review", approvedPath,
      "--out-dir", outputDir,
      "--pretty"
    ], captured.io, {
      generateAndPublish: async (options) => {
        called = true;
        expect(options.tool).toMatchObject({ provenance: inputs.tool.provenance });
        expect(options.analysis).toMatchObject({ analyzer: inputs.analysis.analyzer });
        expect(options.review).toMatchObject({ state: "approved" });
        expect(options.outDir).toBe(outputDir);
        return {
          outDir: outputDir,
          files: [join(outputDir, "writeguard-generation.json")],
          manifest: { kind: "writeguard_generation_manifest" }
        };
      }
    })).toBe(0);
    expect(called).toBe(true);
    expect(JSON.parse(captured.output().stdout)).toMatchObject({
      command: "generate",
      fileCount: 1,
      status: "generated"
    });
    expect(captured.output().stderr).toBe("");
  });

  it("refuses to overwrite an existing review artifact", async () => {
    const root = await temporaryRoot();
    const inputs = await writeInputs(root);
    const reviewPath = join(root, "review.json");
    await writeFile(reviewPath, "user-owned\n");
    const captured = capture();
    expect(await runWriteGuardCli([
      "review", "--tool", inputs.toolPath, "--analysis", inputs.analysisPath, "--out", reviewPath
    ], captured.io)).toBe(5);
    expect(await readFile(reviewPath, "utf8")).toBe("user-owned\n");
    expect(captured.output().stderr).toContain("Refusing to overwrite");
  });
});
