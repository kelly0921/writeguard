import { spawn } from "node:child_process";
import { access, copyFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2];

function commandLine(executable, args) {
  return [executable, ...args]
    .map((value) => /[\s&()^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    .join(" ");
}

function run(executable, args) {
  return new Promise((resolveRun, reject) => {
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine(executable, args)], {
          cwd: root,
          stdio: "inherit"
        })
      : spawn(executable, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${executable} exited with ${code}`)));
  });
}

async function ensurePilotEnvironment() {
  const destination = join(root, ".env.pilot");
  try {
    await access(destination);
  } catch {
    await copyFile(join(root, ".env.pilot.example"), destination);
    console.log("Created ignored .env.pilot from credential-free safe defaults.");
  }
}

function canConnect() {
  return new Promise((resolveConnection) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 54328 });
    const finish = (result) => {
      socket.destroy();
      resolveConnection(result);
    };
    socket.setTimeout(1_000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForPostgres() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await canConnect()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error("Pilot PostgreSQL did not become reachable on localhost:54328 within 45 seconds.");
}

if (command === "start") {
  await ensurePilotEnvironment();
  await run("docker", ["compose", "-p", "writeguard-pilot", "-f", "docker-compose.pilot.yml", "up", "-d"]);
  await waitForPostgres();
  await run("pnpm", ["pilot:setup"]);
  console.log("Pilot sandbox ready. Run `pnpm pilot:validate`, then `pnpm writeguard:doctor`.");
} else if (command === "stop") {
  await run("docker", ["compose", "-p", "writeguard-pilot", "-f", "docker-compose.pilot.yml", "down"]);
  console.log("Pilot sandbox stopped. The local Docker volume is retained; use pilot:reset before stop to clear rows.");
} else {
  console.error("Usage: node scripts/pilot-control.mjs <start|stop>");
  process.exitCode = 1;
}
