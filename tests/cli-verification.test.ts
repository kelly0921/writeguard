import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWriteGuardCli, type WriteGuardCliIo } from "../packages/writeguard/src/cli-program.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

describe("writeguard policy CLI", () => {
  async function artifacts(): Promise<{ receipt: string; policy: string }> {
    const root = await mkdtemp(join(tmpdir(), "writeguard-policy-cli-"));
    roots.push(root);
    const receipt = join(root, "receipt.json");
    const policy = join(root, "policy.json");
    await writeFile(receipt, JSON.stringify({
      receipt: { overallResult: "passed_with_limitations" }
    }));
    await writeFile(policy, JSON.stringify({
      name: "evaluation-release-candidate"
    }));
    return { receipt, policy };
  }

  it("emits JSON and exits zero when named receipt requirements pass", async () => {
    const paths = await artifacts();
    const captured = capture();
    let received: unknown;
    const exit = await runWriteGuardCli(
      ["policy", "check", paths.receipt, "--policy", paths.policy, "--pretty"],
      captured.io,
      {
        evaluatePolicy: async (options) => {
          received = options;
          return { overallResult: "passed", requirements: [] } as any;
        }
      }
    );
    expect(exit).toBe(0);
    expect(received).toEqual({
      receipt: { receipt: { overallResult: "passed_with_limitations" } },
      policy: { name: "evaluation-release-candidate" }
    });
    expect(JSON.parse(captured.output().stdout)).toMatchObject({
      overallResult: "passed"
    });
    expect(captured.output().stderr).toBe("");
  });

  it("uses distinct exit code 7 when policy requirements are unmet", async () => {
    const paths = await artifacts();
    const captured = capture();
    const exit = await runWriteGuardCli(
      ["policy", "check", paths.receipt, "--policy", paths.policy],
      captured.io,
      {
        evaluatePolicy: () => ({
          overallResult: "failed",
          requirements: [{ id: "provider.real_semantics", status: "unsatisfied" }]
        } as any)
      }
    );
    expect(exit).toBe(7);
    expect(JSON.parse(captured.output().stdout)).toMatchObject({
      overallResult: "failed"
    });
  });

  it.each([
    [["policy"], "requires the check subcommand"],
    [["policy", "check"], "requires a verification receipt"],
    [["policy", "check", "receipt.json"], "requires --policy"],
    [["policy", "inspect", "receipt.json", "--policy", "policy.json"], "requires the check subcommand"]
  ])("rejects invalid policy arguments without partial JSON", async (args, expected) => {
    const captured = capture();
    expect(await runWriteGuardCli(args, captured.io)).toBe(7);
    expect(captured.output().stdout).toBe("");
    expect(captured.output().stderr).toContain(expected);
  });
});
