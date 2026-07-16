import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(join(tmpdir(), "writeguard-analyzer-package-verify-"));
const artifactDir = join(tempRoot, "artifacts");
const appDir = join(tempRoot, "app");
const coreDir = join(root, "packages", "writeguard");
const analyzerDir = join(root, "packages", "analyzer-openai");
const fixtureDir = join(root, "fixtures", "analyzer-package-consumer");

function commandLine(command, args) {
  return [command, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function run(command, args, cwd, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", commandLine(command, args)],
          { cwd, stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit", env: options.env ?? process.env }
        )
      : spawn(command, args, {
          cwd,
          stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
          env: options.env ?? process.env
        });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (options.expectedCode !== undefined && code === options.expectedCode) {
        resolveRun({ stdout, stderr, code });
      } else if (code === 0) {
        resolveRun({ stdout, stderr, code });
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}${stderr ? `: ${stderr}` : ""}`));
      }
    });
  });
}

try {
  await mkdir(artifactDir, { recursive: true });
  await run("pnpm", ["--filter", "@closure/writeguard", "build"], root);
  await run("pnpm", ["--filter", "@closure/writeguard-analyzer-openai", "build"], root);
  await run("pnpm", ["pack", "--pack-destination", artifactDir], coreDir);
  await run("pnpm", ["pack", "--pack-destination", artifactDir], analyzerDir);
  const tarballs = await readdir(artifactDir);
  const coreTarball = tarballs.find((name) => /^closure-writeguard-0\.5\.0\.tgz$/.test(name));
  const analyzerTarball = tarballs.find((name) => /^closure-writeguard-analyzer-openai-0\.1\.0\.tgz$/.test(name));
  if (!coreTarball || !analyzerTarball) {
    throw new Error(`Expected core and analyzer tarballs; received ${tarballs.join(", ")}`);
  }

  await cp(fixtureDir, appDir, { recursive: true });
  await run(
    "npm",
    ["install", "--ignore-scripts", join(artifactDir, coreTarball), join(artifactDir, analyzerTarball)],
    appDir
  );
  await run(
    "node",
    [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(appDir, "tsconfig.json")],
    appDir
  );
  await run("node", [join(appDir, "index.mjs")], appDir);

  const cli = await run(
    "node",
    [
      join(appDir, "node_modules", "@closure", "writeguard", "dist", "writeguard", "src", "cli.js"),
      "analyze",
      join(appDir, "mcp-tool.json")
    ],
    appDir,
    { capture: true, expectedCode: 4, env: { ...process.env, OPENAI_API_KEY: "" } }
  );
  if (cli.stdout !== "" || !cli.stderr.includes("OPENAI_API_KEY is not configured")) {
    throw new Error("Packaged analyze CLI did not fail safely and actionably without OPENAI_API_KEY");
  }

  const installedAnalyzer = JSON.parse(
    await readFile(join(appDir, "node_modules", "@closure", "writeguard-analyzer-openai", "package.json"), "utf8")
  );
  if (installedAnalyzer.dependencies?.openai !== "6.47.0") {
    throw new Error("Installed optional package does not pin the verified OpenAI SDK version");
  }
  const result = {
    corePackage: "@closure/writeguard@0.5.0",
    analyzerPackage: "@closure/writeguard-analyzer-openai@0.1.0",
    cleanInstall: "passed",
    generatedDeclarations: "passed",
    publicFakeTransport: "passed",
    trustedProvenance: "passed",
    packagedCliMissingKeyFailure: "passed",
    networkCalls: 0
  };
  await mkdir(join(root, ".writeguard"), { recursive: true });
  await writeFile(
    join(root, ".writeguard", "openai-analyzer-package-verification.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
  console.log(`OpenAI analyzer package verification passed: ${JSON.stringify(result)}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}
