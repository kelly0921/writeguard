import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workflow = await readFile(
  resolve(root, ".github", "workflows", "evaluation.yml"),
  "utf8"
);

const required = [
  "permissions:\n  contents: read",
  "ubuntu-latest",
  "windows-latest",
  "pnpm install --frozen-lockfile",
  "pnpm evaluate:local",
  "actions/upload-artifact@v4",
  ".writeguard/evaluation-*"
];
for (const value of required) {
  if (!workflow.includes(value)) {
    throw new Error(`Evaluation workflow is missing required content: ${value}`);
  }
}
for (const forbidden of [
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "DATABASE_URL",
  "pull_request_target",
  "permissions: write-all"
]) {
  if (workflow.includes(forbidden)) {
    throw new Error(`Evaluation workflow contains forbidden content: ${forbidden}`);
  }
}
console.log("Evaluation CI example passes local structural validation.");
