// Runs the unit tests: copies lib/ to .unit/lib with explicit .ts import extensions (so Node can run the
// TypeScript directly), then runs every tests/*.mjs from .unit with a throwaway data folder.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, ".unit");
fs.rmSync(out, { recursive: true, force: true });

function copy(dir, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const src = path.join(dir, e.name);
    if (e.isDirectory()) { copy(src, path.join(to, e.name)); continue; }
    if (!e.name.endsWith(".ts")) continue;
    const code = fs.readFileSync(src, "utf8").replace(/((?:from|import)\s*\(?\s*)(["'])(\.{1,2}\/[^"']+)\2/g, (m, pre, q, p) => {
      if (p.endsWith(".ts")) return m;
      return `${pre}${q}${fs.existsSync(path.join(dir, p)) && fs.statSync(path.join(dir, p)).isDirectory() ? `${p}/index.ts` : `${p}.ts`}${q}`;
    });
    fs.writeFileSync(path.join(to, e.name), code);
  }
}
copy(path.join(root, "lib"), path.join(out, "lib"));
const tests = fs.readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".mjs") && !process.argv[2] || f === process.argv[2]);
let failed = false;
for (const t of tests) {
  fs.copyFileSync(path.join(root, "tests", t), path.join(out, t));
  const data = path.join(out, `data-${t.replace(/\W/g, "_")}`);
  console.log(`\n# ${t}`);
  try {
    execFileSync(process.execPath, ["--no-warnings", t], { cwd: out, stdio: "inherit", env: { ...process.env, DATA_DIR: data, SANDBOX_THROTTLE: process.env.SANDBOX_THROTTLE ?? "1" } });
  } catch {
    failed = true;
  }
}
if (!process.env.KEEP_UNIT) fs.rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
