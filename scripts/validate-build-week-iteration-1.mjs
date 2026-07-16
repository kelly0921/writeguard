import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = join(root, ".writeguard");
const manifest = JSON.parse(
  await readFile(join(root, "packages", "writeguard", "package.json"), "utf8")
);
const commands = [
  { name: "complete pre-existing and pilot regression", args: ["validate:pilot-ready"] },
  {
    name: "refund MCP normalization CLI",
    args: ["writeguard", "normalize-mcp", "fixtures/mcp-tools/refund-order.json"]
  },
  {
    name: "email MCP normalization CLI",
    args: ["writeguard", "normalize-mcp", "fixtures/mcp-tools/send-email.json"]
  },
  {
    name: "read-only MCP normalization CLI",
    args: ["writeguard", "normalize-mcp", "fixtures/mcp-tools/lookup-order.json"]
  }
];

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function runPnpm(args) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine("pnpm", args)], {
          cwd: root,
          stdio: "inherit"
        })
      : spawn("pnpm", args, { cwd: root, stdio: "inherit" });
    child.on("error", (error) =>
      resolveRun({ passed: false, durationMs: Date.now() - startedAt, error: error.message })
    );
    child.on("exit", (code) =>
      resolveRun({
        passed: code === 0,
        durationMs: Date.now() - startedAt,
        ...(code === 0 ? {} : { error: `exit code ${code}` })
      })
    );
  });
}

const startedAt = new Date();
const checks = [];
let failed = false;
for (const command of commands) {
  if (failed) {
    checks.push({ name: command.name, status: "not_run", durationMs: 0 });
    continue;
  }
  console.log(`\n[build-week-iteration-1] ${command.name}`);
  const result = await runPnpm(command.args);
  checks.push({
    name: command.name,
    status: result.passed ? "passed" : "failed",
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {})
  });
  failed = !result.passed;
}

const finishedAt = new Date();
const report = {
  iteration: "OpenAI Build Week Iteration 1",
  status: failed ? "failed" : "iteration_1_complete_locally",
  package: `@closure/writeguard@${manifest.version}`,
  contractVersion: "writeguard.analysis/v1",
  externalDeveloperValidations: 0,
  published: false,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  checks
};
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  join(reportDirectory, "build-week-iteration-1.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
const markdown = [
  "# Build Week Iteration 1 Validation",
  "",
  `Status: **${report.status}**`,
  "",
  `Package: ${report.package}`,
  `Contract: ${report.contractVersion}`,
  `External developer validations: ${report.externalDeveloperValidations}`,
  `Published: ${report.published}`,
  "",
  "| Check | Status | Duration |",
  "|---|---|---:|",
  ...checks.map((check) => `| ${check.name} | ${check.status} | ${(check.durationMs / 1000).toFixed(2)}s |`),
  "",
  "This report records local validation only. It contains no tool input values, credentials, or model output."
].join("\n");
await writeFile(join(reportDirectory, "build-week-iteration-1.md"), `${markdown}\n`, "utf8");
console.log(`\nBuild Week Iteration 1 report: ${join(reportDirectory, "build-week-iteration-1.json")}`);
if (failed) process.exitCode = 1;
