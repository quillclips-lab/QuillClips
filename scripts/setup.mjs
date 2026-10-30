// One-time setup: Python venv + dependencies + first model downloads.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = path.join(root, "worker");
const isWin = process.platform === "win32";
const venvPy = path.join(worker, ".venv", isWin ? "Scripts/python.exe" : "bin/python");

function sh(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: worker, ...opts });
  if (r.status !== 0) {
    console.error(`\n[QuillClips] Komut başarısız: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

function findPython() {
  for (const c of isWin ? ["py", "python", "python3"] : ["python3.12", "python3.11", "python3", "python"]) {
    try {
      const args = c === "py" ? ["-3", "--version"] : ["--version"];
      const v = execFileSync(c, args, { encoding: "utf8" }).trim();
      const m = v.match(/Python 3\.(\d+)/);
      if (m && Number(m[1]) >= 10 && Number(m[1]) <= 13) return c === "py" ? ["py", "-3"] : [c];
    } catch {}
  }
  return null;
}

for (const bin of ["ffmpeg", "ffprobe"]) {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" });
  } catch {
    console.error(`\n[QuillClips] ${bin} bulunamadı. README'deki ffmpeg kurulum adımlarını uygulayın.`);
    process.exit(1);
  }
}
try {
  execFileSync("claude", ["--version"], { stdio: "ignore", shell: isWin });
} catch {
  console.warn("\n[QuillClips] Uyarı: 'claude' CLI bulunamadı. Claude Code'u kurup giriş yapmadan analiz çalışmaz.");
}

if (!existsSync(venvPy)) {
  const py = findPython();
  if (!py) {
    console.error("\n[QuillClips] Python 3.10-3.13 bulunamadı. README'ye bakın.");
    process.exit(1);
  }
  sh(py[0], [...py.slice(1), "-m", "venv", ".venv"]);
}
sh(venvPy, ["-m", "pip", "install", "--upgrade", "pip"]);
sh(venvPy, ["-m", "pip", "install", "-r", "requirements.txt"]);
sh(venvPy, ["setup_models.py"], { env: { ...process.env, HF_HUB_DISABLE_SYMLINKS_WARNING: "1", PYTHONUTF8: "1" } });

// Remotion renders with a local headless Chrome; download it once now instead of on the first render.
console.log("\n> Remotion tarayıcısı (chrome-headless-shell)");
const { ensureBrowser } = await import("@remotion/renderer");
await ensureBrowser();
console.log("\n[QuillClips] Kurulum tamam. Başlatmak için:  npm run dev\n");
