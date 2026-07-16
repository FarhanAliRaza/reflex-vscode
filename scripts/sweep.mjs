// Real-world sweep: run the region scanner (and optionally the grammar
// tokenizer) over arbitrary .py files and report what was detected, to hunt
// false positives. Usage: node scripts/sweep.mjs [--tokenize] <files...>
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..");
const outfile = path.join(os.tmpdir(), `reflex-regions-${process.pid}.mjs`);
buildSync({
  entryPoints: [path.join(root, "src", "regions.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
});
const { scanRegions } = await import(pathToFileURL(outfile).href);

const statsIdx = process.argv.indexOf("--stats");
if (statsIdx !== -1) {
  const { readdirSync, statSync } = await import("node:fs");
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      const s = statSync(p);
      if (s.isDirectory() && !e.startsWith(".")) walk(p);
      else if (e.endsWith(".py")) files.push(p);
    }
  })(process.argv[statsIdx + 1]);
  let total = 0,
    totalMs = 0,
    maxMs = 0,
    maxFile = "";
  const langCounts = {};
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const t0 = performance.now();
    const regions = scanRegions(text);
    const ms = performance.now() - t0;
    totalMs += ms;
    if (ms > maxMs) {
      maxMs = ms;
      maxFile = f;
    }
    total += regions.length;
    for (const r of regions) {
      langCounts[r.language] = (langCounts[r.language] ?? 0) + 1;
    }
  }
  console.log(
    `${files.length} files, ${total} regions, total ${totalMs.toFixed(0)}ms, slowest ${maxMs.toFixed(1)}ms (${maxFile})`
  );
  console.log(langCounts);
  process.exit(0);
}

const args = process.argv.slice(2).filter((a) => a !== "--tokenize");
for (const file of args) {
  const text = readFileSync(file, "utf8");
  const t0 = performance.now();
  const regions = scanRegions(text);
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`\n=== ${file} (${text.length} chars, ${ms}ms, ${regions.length} regions)`);
  for (const r of regions) {
    const preview = text
      .slice(r.start, Math.min(r.end, r.start + 60))
      .replace(/\n/g, "\\n");
    console.log(
      `  [${r.language}${r.cssProperty ? ":" + r.cssProperty : ""}]${r.fstring ? " f" : ""} ${preview}`
    );
  }
}
