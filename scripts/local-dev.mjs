import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const root = process.cwd();
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });
const dataDir = path.join(root, ".beeblio");
mkdirSync(dataDir, { recursive: true });

const isWindows = process.platform === "win32";

function findWindowsCodexBinDir() {
  if (!isWindows) return undefined;

  const appData = process.env.APPDATA;
  const arch = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const platformPackage =
    process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";

  const candidates = [
    appData &&
      path.join(
        appData,
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        "@openai",
        platformPackage,
        "vendor",
        arch,
        "bin",
      ),
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      platformPackage,
      "vendor",
      arch,
      "bin",
    ),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (existsSync(path.join(dir, "codex.exe"))) return dir;
  }
  return undefined;
}

const codexBinDir = findWindowsCodexBinDir();
const env = {
  ...process.env,
  LOCAL_DB_PATH: process.env.LOCAL_DB_PATH || path.join(dataDir, "beeblio.sqlite"),
  AGENT_URL: "http://127.0.0.1:2000",
};

if (codexBinDir) {
  // Preserve Windows' existing Path/PATH entry exactly, then prepend codex.exe.
  // Adding a new differently-cased PATH key can hide Node from cmd.exe.
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
  const existingPath = env[pathKey] || "";
  env[pathKey] = `${codexBinDir}${path.delimiter}${existingPath}`;
  env.CODEX_CLI_PATH = env.CODEX_CLI_PATH || path.join(codexBinDir, "codex.exe");
  console.log(`Using native Codex CLI: ${env.CODEX_CLI_PATH}`);
} else if (isWindows) {
  console.warn(
    "Native Codex CLI was not found. ChatGPT subscription auth may fall back to Eve browser OAuth.",
  );
}

const bin = (name) => path.join(root, "node_modules", ".bin", isWindows ? `${name}.cmd` : name);
const spawnBin = (name, args) =>
  spawn(bin(name), args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: isWindows,
  });

function run(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawnBin(name, args);
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`)),
    );
  });
}

await run("drizzle-kit", ["migrate"]);

const children = [
  spawnBin("next", ["dev", "--hostname", "127.0.0.1"]),
  spawnBin("eve", ["dev", "--no-ui", "--host", "127.0.0.1", "--port", "2000"]),
];

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);

for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    stop();
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(`Local server exited (${code})`);
      stop();
      process.exitCode = code || 1;
    }
  });
}
