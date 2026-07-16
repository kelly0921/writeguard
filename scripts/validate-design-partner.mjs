import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = join(root, ".writeguard");
const commands = [
  { name: "database migrations", args: ["db:migrate"] },
  { name: "secret scan", args: ["security:scan"] },
  { name: "public package build and declarations", args: ["--filter", "@closure/writeguard", "build"] },
  { name: "typecheck", args: ["typecheck"] },
  { name: "production build", args: ["build"] },
  { name: "unit and shadow tests", args: ["test:unit"] },
  {
    name: "PostgreSQL, concurrency, crash, MCP, shadow, and starter tests",
    args: ["test:integration"]
  },
  { name: "clean tarball installation", args: ["package:verify"] },
  { name: "design-partner starter demo", args: ["demo:starter"] },
  { name: "sanitized public demo", args: ["demo:public"] }
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
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", commandLine("pnpm", args)],
          { cwd: root, stdio: "inherit" }
        )
      : spawn("pnpm", args, { cwd: root, stdio: "inherit" });
    child.on("error", (error) => resolveRun({ passed: false, durationMs: Date.now() - startedAt, error: error.message }));
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
  console.log(`\n[design-partner] ${command.name}`);
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
  milestone: "WriteGuard Milestone 3",
  status: failed ? "failed" : "ready_for_one_sandbox_design_partner",
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  checks
};
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  join(reportDirectory, "design-partner-readiness.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
const markdown = [
  "# Local Design-Partner Readiness",
  "",
  `Status: **${report.status}**`,
  "",
  `Generated: ${finishedAt.toISOString()}`,
  "",
  "| Check | Status | Duration |",
  "|---|---|---:|",
  ...checks.map((check) => `| ${check.name} | ${check.status} | ${(check.durationMs / 1000).toFixed(2)}s |`),
  "",
  "This report contains validation status and duration only. It contains no operation payloads, provider responses, or credentials."
].join("\n");
await writeFile(join(reportDirectory, "design-partner-readiness.md"), `${markdown}\n`, "utf8");
console.log(`\nReadiness report: ${join(reportDirectory, "design-partner-readiness.json")}`);
if (failed) process.exitCode = 1;
