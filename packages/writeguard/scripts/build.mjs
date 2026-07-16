import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");
const dist = join(packageRoot, "dist");
const migrations = join(packageRoot, "migrations");
const migrationNames = ["0000_initial", "0001_ordered_events", "0004_shadow_observations"];

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            [command, ...args]
              .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
              .join(" ")
          ],
          { cwd, stdio: "inherit" }
        )
      : spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

await rm(dist, { recursive: true, force: true });
await rm(migrations, { recursive: true, force: true });
await run("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], packageRoot);
await mkdir(migrations, { recursive: true });
for (const migrationName of migrationNames) {
  await cp(
    join(workspaceRoot, "packages", "core", "drizzle", `${migrationName}.sql`),
    join(migrations, `${migrationName}.sql`)
  );
}
console.log("Built @closure/writeguard with declarations and public migrations.");
