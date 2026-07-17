import { describe, expect, it } from "vitest";
import { runWriteGuardCli, type WriteGuardCliIo } from "../packages/writeguard/src/cli-program.js";

function capture(): {
  io: WriteGuardCliIo;
  output(): { stdout: string; stderr: string };
} {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
      readStdin: async () => ""
    },
    output: () => ({ stdout, stderr })
  };
}

function verificationResult(overallResult: "passed_with_limitations" | "failed" = "passed_with_limitations") {
  return {
    receipt: {
      schemaVersion: "writeguard.verification/v1",
      kind: "writeguard_verification_receipt",
      overallResult,
      limitations: [{ code: "simulated_provider_only" }]
    },
    receiptDigest: "a".repeat(64),
    runtime: {
      durationMs: 10,
      compilationDurationMs: 5,
      generatedTestDurationMs: null
    }
  } as any;
}

describe("writeguard verify CLI", () => {
  it("runs safe static verification by default and emits JSON-only stdout", async () => {
    const captured = capture();
    let received: unknown;
    const exit = await runWriteGuardCli(
      ["verify", "./generated", "--pretty"],
      captured.io,
      {
        verifyGenerated: async (options) => {
          received = options;
          return verificationResult();
        }
      }
    );
    expect(exit).toBe(0);
    expect(received).toEqual({
      directory: "./generated",
      runTests: false,
      strict: false
    });
    expect(JSON.parse(captured.output().stdout)).toMatchObject({
      receipt: { overallResult: "passed_with_limitations" }
    });
    expect(captured.output().stderr).toBe("");
  });

  it("requires explicit --run-tests and forwards only controlled verification options", async () => {
    const captured = capture();
    let received: unknown;
    const exit = await runWriteGuardCli(
      [
        "verify",
        "./generated",
        "--run-tests",
        "--strict",
        "--provider-file",
        "provider/simulated.ts",
        "--timeout-ms",
        "15000"
      ],
      captured.io,
      {
        verifyGenerated: async (options) => {
          received = options;
          return verificationResult();
        }
      }
    );
    expect(exit).toBe(0);
    expect(received).toEqual({
      directory: "./generated",
      runTests: true,
      strict: true,
      providerFile: "provider/simulated.ts",
      timeoutMs: 15000
    });
    expect(captured.output().stderr).toContain("not a security sandbox");
  });

  it("returns exit code 6 with a complete failed receipt", async () => {
    const captured = capture();
    const exit = await runWriteGuardCli(
      ["verify", "./tampered"],
      captured.io,
      { verifyGenerated: async () => verificationResult("failed") }
    );
    expect(exit).toBe(6);
    expect(JSON.parse(captured.output().stdout)).toMatchObject({
      receipt: { overallResult: "failed" }
    });
  });

  it.each([
    [["verify"], "requires a generated directory"],
    [["verify", "./one", "./two"], "exactly one generated directory"],
    [["verify", "./one", "--run-tests=false"], "unsupported argument"],
    [["verify", "./one", "--timeout-ms", "5"], "100 through 120000"]
  ])("rejects invalid arguments without partial JSON", async (args, expected) => {
    const captured = capture();
    expect(await runWriteGuardCli(args, captured.io)).toBe(6);
    expect(captured.output().stdout).toBe("");
    expect(captured.output().stderr).toContain(expected);
  });
});
