import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "packages", "generator", "package.json"), "utf8"));
if (manifest.dependencies?.openai || manifest.optionalDependencies?.openai || manifest.peerDependencies?.openai) {
  throw new Error("@closure/writeguard-generator must not depend on the OpenAI SDK");
}

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

const output = await new Promise((resolveOutput, reject) => {
  const args = ["--filter", "@closure/writeguard-generator", "list", "--prod", "--depth", "Infinity", "--json"];
  const child = process.platform === "win32"
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine("pnpm", args)], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"]
      })
    : spawn("pnpm", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("error", reject);
  child.on("exit", (code) => code === 0
    ? resolveOutput(stdout)
    : reject(new Error(stderr || `pnpm list exited ${code}`)));
});

const graph = JSON.parse(output);
const serialized = JSON.stringify(graph);
if (/"openai"\s*:/.test(serialized) || /node_modules[\\/]openai(?:[\\/]")?/.test(serialized)) {
  throw new Error("OpenAI SDK appeared in the generator production dependency graph");
}
const result = {
  package: `@closure/writeguard-generator@${manifest.version}`,
  status: "passed",
  openaiManifestDependency: false,
  openaiProductionGraphDependency: false
};
await mkdir(join(root, ".writeguard"), { recursive: true });
await writeFile(
  join(root, ".writeguard", "generator-dependency-boundary.json"),
  `${JSON.stringify(result, null, 2)}\n`
);
console.log(`Generator OpenAI dependency boundary passed: ${JSON.stringify(result)}`);
