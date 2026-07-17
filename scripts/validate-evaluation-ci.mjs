import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workflow = await readFile(
  resolve(root, ".github", "workflows", "evaluation.yml"),
  "utf8"
);
const pilotWorkflow = await readFile(
  resolve(root, ".github", "workflows", "ci.yml"),
  "utf8"
);

const required = [
  "permissions:\n  contents: read",
  "branches: [master, main]",
  "ubuntu-latest",
  "windows-latest",
  "pnpm install --frozen-lockfile",
  "pnpm typecheck",
  "pnpm build",
  "pnpm test:unit",
  "pnpm validate:generated-artifacts",
  "pnpm package:verify-generator",
  "pnpm verify:core-openai-boundary",
  "pnpm verify:generator-boundary",
  "pnpm security:scan",
  "pnpm docs:scan",
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
for (const value of [
  "branches: [master, main]",
  "image: postgres:16-alpine",
  "pnpm install --frozen-lockfile",
  "pnpm validate:pilot-ci"
]) {
  if (!pilotWorkflow.includes(value)) {
    throw new Error(`Pilot workflow is missing required content: ${value}`);
  }
}
console.log("Evaluation CI example passes local structural validation.");
