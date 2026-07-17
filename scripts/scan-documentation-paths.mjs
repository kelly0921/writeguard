import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const roots = [
  resolve(root, "README.md"),
  resolve(root, "BUILD_WEEK.md"),
  resolve(root, "docs"),
  resolve(root, ".github", "workflows")
];
const files = [];

async function visit(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await visit(child);
    else if (/\.(?:md|ya?ml|json)$/i.test(entry.name)) files.push(child);
  }
}

for (const path of roots) {
  if (/\.[A-Za-z0-9]+$/.test(path)) files.push(path);
  else await visit(path);
}

const problems = [];
for (const path of files) {
  const content = await readFile(path, "utf8");
  if (/[A-Za-z]:\\Users\\[^<\s]+|\/Users\/[^/<\s]+\/|file:\/\//i.test(content)) {
    problems.push(`${path}: absolute user path`);
  }
  if (
    /sk_(?:test|live)_[A-Za-z0-9]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}/
      .test(content)
  ) {
    problems.push(`${path}: credential-shaped value`);
  }
}

const readme = await readFile(resolve(root, "README.md"), "utf8");
if (!readme.includes("pnpm evaluate:local")) {
  problems.push("README.md: canonical zero-credential evaluation is missing");
}
if (problems.length > 0) {
  throw new Error(`Documentation hygiene failed:\n${problems.join("\n")}`);
}
console.log(`Documentation hygiene passed for ${files.length} files.`);
