import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const fixture = join(root, "fixtures", "evaluation-release-candidate");

async function fixtureText(): Promise<string> {
  const values: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else values.push(await readFile(path, "utf8"));
    }
  }
  await visit(fixture);
  return values.join("\n");
}

describe("evaluation release candidate", () => {
  it("has one canonical evaluator and keeps the prior public-demo name as an alias", async () => {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(manifest.scripts["evaluate:local"]).toBe("node scripts/evaluate-local.mjs");
    expect(manifest.scripts["demo:public"]).toBe("pnpm evaluate:local");
    await expect(readFile(join(root, "scripts", "public-demo.mjs"), "utf8")).rejects.toThrow();
  });

  it("uses packed public packages without workspace or private-source imports", async () => {
    const text = await fixtureText();
    expect(text).not.toContain("workspace:");
    expect(text).not.toContain("../../packages/");
    expect(text).not.toContain("packages/writeguard/src");
    expect(text).not.toContain("packages/generator/src");
    expect(text).toContain("@closure/writeguard");
    expect(text).toContain("@closure/writeguard-generator");
  });

  it("requires no OpenAI, Stripe, network, or PostgreSQL runtime in the fixture", async () => {
    const text = await fixtureText();
    expect(text).not.toMatch(/from\s+["'](?:node:)?(?:http|https|net|tls|undici|openai|stripe)["']/);
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("OPENAI_API_KEY");
    expect(text).not.toContain("STRIPE_SECRET_KEY");
  });

  it("keeps approval explicit and receipt policy machine-readable", async () => {
    const setup = await readFile(join(fixture, "src", "setup.mjs"), "utf8");
    const policy = JSON.parse(
      await readFile(join(fixture, "writeguard.policy.json"), "utf8")
    );
    expect(setup).toContain("approveGuardGenerationReview");
    expect(setup).toContain("approvalWasInferred: false");
    expect(policy).toMatchObject({
      schemaVersion: "writeguard.verification-policy/v1",
      requirements: {
        realProviderSemantics: "not_required",
        receiptLimitations: "allow_declared"
      }
    });
  });
});
