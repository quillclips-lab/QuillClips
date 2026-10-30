// Starts the Python worker (FastAPI, :8765) and Next.js (:3000) together. Ctrl+C stops both.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const py = path.join(root, "worker", ".venv", isWin ? "Scripts/python.exe" : "bin/python");
const prod = process.argv.includes("--prod");

if (!existsSync(py)) {
  console.error("\n[QuillClips] Python ortamı bulunamadı. Önce kurulumu çalıştırın:  npm run setup\n");
  process.exit(1);
}

const children = [];
function run(name, color, cmd, args, opts) {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...opts?.env }, shell: opts?.shell ?? false });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) out.write(tag + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${tag}çıktı (kod ${code})`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode === null) {
      if (isWin) spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"]);
      else c.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("worker", "36", py, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8765", "--app-dir", "worker"], {
  env: { PYTHONUNBUFFERED: "1", PYTHONUTF8: "1", HF_HUB_DISABLE_SYMLINKS_WARNING: "1" },
});
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
run("web", "35", process.execPath, [nextBin, prod ? "start" : "dev", "-p", "3000", "-H", "127.0.0.1"]);

console.log("\n  QuillClips  →  http://127.0.0.1:3000   (worker: http://127.0.0.1:8765)\n");
