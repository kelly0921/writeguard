import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", commandLine("pnpm", args)],
          { cwd: root, stdio: "inherit" }
        )
      : spawn("pnpm", args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`pnpm ${args.join(" ")} exited with ${code}`));
    });
  });
}

console.log("WriteGuard credential-free public validation\n");
console.log("[1/3] Ordinary retry: two invocations create two effects");
await run(["demo:ordinary"]);
console.log("\n[2/3] MCP agent retry: call_A -> UNKNOWN; call_B -> reconciliation -> one effect");
await run(["demo:agent"]);
console.log("\n[3/3] Ten callers and real child-process crash recovery");
await run(["test:concurrency"]);

console.log(`
PUBLIC DEMO RESULT
ordinary agent: call_A + call_B -> 2 external effects
WriteGuard:      call_A -> UNKNOWN -> call_B -> reconciliation -> 1 external effect
identity:        different framework call IDs -> one stable business-operation key
concurrency:     10 callers -> one operation, one receipt, one external effect
process crash:   provider commit -> worker exit -> replacement reconciliation -> CONFIRMED
credentials:     none required
`);
