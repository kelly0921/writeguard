import { describe, expect, it } from "vitest";
import { runWriteGuardCli, type WriteGuardCliIo } from "../packages/writeguard/src/cli-program.js";
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };

function capture(stdin: string) {
  let stdout = "";
  let stderr = "";
  const io: WriteGuardCliIo = {
    stdout: (message) => { stdout += message; },
    stderr: (message) => { stderr += message; },
    readStdin: async () => stdin
  };
  return { io, output: () => ({ stdout, stderr }) };
}

describe("Iteration 1 CLI", () => {
  it("emits deterministic machine-readable normalized JSON to stdout", async () => {
    const first = capture(JSON.stringify(refundTool));
    const second = capture(JSON.stringify(refundTool));
    expect(await runWriteGuardCli(["normalize-mcp", "-"], first.io)).toBe(0);
    expect(await runWriteGuardCli(["normalize-mcp", "-"], second.io)).toBe(0);
    expect(first.output().stderr).toBe("");
    expect(first.output().stdout).toBe(second.output().stdout);
    expect(JSON.parse(first.output().stdout)).toMatchObject({
      kind: "normalized_tool_definition",
      tool: { name: "refund_order" }
    });
  });

  it("uses stderr and a validation exit code for invalid input", async () => {
    const captured = capture("not-json");
    expect(await runWriteGuardCli(["normalize-mcp", "-"], captured.io)).toBe(3);
    expect(captured.output().stdout).toBe("");
    expect(captured.output().stderr).toContain("input is not valid JSON");
  });

  it("does not expose a misleading analyze command before an analyzer exists", async () => {
    const captured = capture("");
    expect(await runWriteGuardCli(["analyze", "tool.json"], captured.io)).toBe(2);
    expect(captured.output().stderr).toContain("unsupported command analyze");
  });
});
