import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "packages", "writeguard");
const reportDirectory = join(root, ".writeguard");
const sourceManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine(command, args)], {
          cwd,
          stdio: "inherit"
        })
      : spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function readTar(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const fullName = (prefix ? `${prefix}/${name}` : name).replace(/^package\//, "");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const bodyStart = offset + 512;
    files.set(fullName, buffer.subarray(bodyStart, bodyStart + size));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "writeguard-tarball-"));
try {
  await run("pnpm", ["build"], packageRoot);
  await run("pnpm", ["pack", "--pack-destination", temporaryDirectory], packageRoot);
  const tarballName = (await readdir(temporaryDirectory)).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("pnpm pack did not produce a tarball");
  const files = readTar(gunzipSync(await readFile(join(temporaryDirectory, tarballName))));
  const names = [...files.keys()].filter(Boolean).sort();
  const required = [
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "dist/writeguard/src/index.js",
    "dist/writeguard/src/index.d.ts",
    "dist/writeguard/src/testing.js",
    "dist/writeguard/src/testing.d.ts",
    "dist/writeguard/src/analysis/index.js",
    "dist/writeguard/src/analysis/index.d.ts",
    "dist/writeguard/src/analysis/contracts.js",
    "dist/writeguard/src/cli.js",
    "migrations/0000_initial.sql",
    "migrations/0001_ordered_events.sql",
    "migrations/0004_shadow_observations.sql"
  ];
  const missing = required.filter((name) => !files.has(name));
  const forbidden = names.filter((name) =>
    name === ".env" ||
    name.startsWith("src/") ||
    name.includes("node_modules/") ||
    /(?:^|\/)tests?\//.test(name) ||
    (name.startsWith("migrations/") && !required.includes(name))
  );
  const manifest = JSON.parse(files.get("package.json")?.toString("utf8") ?? "null");
  if (manifest?.name !== "@closure/writeguard" || manifest?.version !== sourceManifest.version) {
    throw new Error(`Tarball manifest does not contain @closure/writeguard@${sourceManifest.version} identity`);
  }
  if (!manifest?.exports?.["."] || !manifest?.exports?.["./testing"] ||
      !manifest?.exports?.["./analysis"] || !manifest?.bin?.writeguard) {
    throw new Error("Tarball manifest is missing explicit public exports");
  }
  if (missing.length > 0 || forbidden.length > 0) {
    throw new Error(`Tarball inspection failed; missing=${missing.join(",") || "none"}; forbidden=${forbidden.join(",") || "none"}`);
  }
  const report = {
    package: `@closure/writeguard@${sourceManifest.version}`,
    status: "passed",
    tarballFileCount: names.length,
    requiredFiles: required,
    forbiddenFiles: forbidden
  };
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(join(reportDirectory, "tarball-inspection.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Tarball inspection passed: ${names.length} files, explicit exports, public migrations only.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
