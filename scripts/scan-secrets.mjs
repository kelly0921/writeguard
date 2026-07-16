import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".pnpm-store", "node_modules", "dist", "coverage", ".docker-config"]);
const includedExtensions = new Set([".ts", ".js", ".mjs", ".json", ".md", ".yaml", ".yml", ".example"]);
const secretPatterns = [
  { name: "Stripe secret key", expression: /sk_(?:test|live)_[A-Za-z0-9]{12,}/g },
  { name: "OpenAI API key", expression: /sk-proj-[A-Za-z0-9_-]{12,}/g }
];
const findings = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.name === ".env") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    if (!includedExtensions.has(extname(entry.name)) && entry.name !== ".env.example") continue;
    const content = await readFile(path, "utf8");
    for (const pattern of secretPatterns) {
      pattern.expression.lastIndex = 0;
      if (pattern.expression.test(content)) {
        findings.push(`${pattern.name}: ${relative(root, path)}`);
      }
    }
  }
}

await visit(root);
if (findings.length > 0) {
  console.error("Potential committed secrets found:\n" + findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Secret scan passed: no credential-shaped values found in repository source files.");
}
