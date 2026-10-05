import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const root = process.cwd();
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });
const dataDir = path.join(root, ".beeblio");
mkdirSync(dataDir, { recursive: true });
const env = { ...process.env, LOCAL_DB_PATH: process.env.LOCAL_DB_PATH || path.join(dataDir, "beeblio.sqlite"), AGENT_URL: "http://127.0.0.1:2000" };
const isWindows = process.platform === "win32";
const bin = (name) => path.join(root, "node_modules", ".bin", isWindows ? `${name}.cmd` : name);
const spawnBin = (name, args) => spawn(bin(name), args, {
  cwd: root,
  env,
  stdio: "inherit",
  shell: isWindows,
});
function run(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawnBin(name, args);
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`)));
  });
}
await run("drizzle-kit", ["migrate"]);
const children = [
  spawnBin("next", ["dev", "--hostname", "127.0.0.1"]),
  spawnBin("eve", ["dev", "--no-ui", "--host", "127.0.0.1", "--port", "2000"]),
];
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill("SIGTERM"); }
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const child of children) {
  child.once("error", (error) => { console.error(error); stop(); process.exitCode = 1; });
  child.once("exit", (code) => { if (!stopping) { console.error(`Local server exited (${code})`); stop(); process.exitCode = code || 1; } });
}
