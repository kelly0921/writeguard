import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(join(tmpdir(), "writeguard-package-verify-"));
const artifactDir = join(tempRoot, "artifacts");
const appDir = join(tempRoot, "app");
const packageDir = join(root, "packages", "writeguard");
const fixtureDir = join(root, "fixtures", "package-consumer");

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

await mkdir(artifactDir, { recursive: true });
await run("pnpm", ["--filter", "@closure/writeguard", "build"], root);
await run("pnpm", ["pack", "--pack-destination", artifactDir], packageDir);
const tarballName = (await readdir(artifactDir)).find((name) => name.endsWith(".tgz"));
if (!tarballName) throw new Error("Package verification did not produce a tarball");
const tarballPath = join(artifactDir, tarballName);

await cp(fixtureDir, appDir, { recursive: true });
await run("pnpm", ["add", "--ignore-workspace", tarballPath], appDir);
await run(
  "node",
  [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(appDir, "tsconfig.json")],
  appDir
);
await run("node", [join(appDir, "index.mjs")], appDir);
await run("pnpm", ["exec", "writeguard", "normalize-mcp", join(appDir, "mcp-tool.json")], appDir);

const result = {
  package: "@closure/writeguard",
  tarball: tarballName,
  cleanInstall: "passed",
  typeDeclarations: "passed",
  analysisSubpath: "passed",
  cliBin: "passed",
  guardedAction: "passed",
  externalEffects: 1
};
const resultDirectory = join(root, ".writeguard");
await mkdir(resultDirectory, { recursive: true });
await writeFile(
  join(resultDirectory, "package-verification.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8"
);
console.log(`Package verification passed: ${JSON.stringify(result)}`);
await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
