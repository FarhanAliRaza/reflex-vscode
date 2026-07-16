// Snapshot tests for the injection grammar. Tokenizes every fixtures/*.py
// with MagicPython + reflex.injection (+ embedded language grammars) and
// compares the token/scope dump against test/grammar/snapshots/*.snap.
// Run with --update to (re)write snapshots.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const vsctm = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..", "..");
const update = process.argv.includes("--update");

const grammarPaths = {
  "source.python": "test/grammars/MagicPython.tmLanguage.json",
  "source.css": "test/grammars/css.tmLanguage.json",
  "source.js": "test/grammars/JavaScript.tmLanguage.json",
  "source.js.jsx": "test/grammars/JavaScriptReact.tmLanguage.json",
  "source.ts": "test/grammars/TypeScript.tmLanguage.json",
  "text.html.basic": "test/grammars/html.tmLanguage.json",
  "reflex.injection": "syntaxes/reflex.injection.tmLanguage.json",
  "reflex-fstring.injection": "syntaxes/reflex-fstring.injection.tmLanguage.json",
  "reflex-methodbody.injection":
    "syntaxes/reflex-methodbody.injection.tmLanguage.json",
  "reflex-jstemplate.injection":
    "syntaxes/reflex-jstemplate.injection.tmLanguage.json",
};

const wasmBin = readFileSync(
  require.resolve("vscode-oniguruma/release/onig.wasm")
).buffer;
const onigLib = oniguruma.loadWASM(wasmBin).then(() => ({
  createOnigScanner: (p) => new oniguruma.OnigScanner(p),
  createOnigString: (s) => new oniguruma.OnigString(s),
}));

const registry = new vsctm.Registry({
  onigLib,
  loadGrammar: async (scopeName) => {
    const p = grammarPaths[scopeName];
    if (!p) return null;
    return vsctm.parseRawGrammar(
      readFileSync(path.join(root, p), "utf8"),
      path.join(root, p)
    );
  },
  getInjections: (scopeName) =>
    scopeName === "source.python"
      ? [
          "reflex.injection",
          "reflex-fstring.injection",
          "reflex-methodbody.injection",
          "reflex-jstemplate.injection",
        ]
      : undefined,
});

function tokenizeFile(grammar, text) {
  const lines = text.split("\n");
  let ruleStack = vsctm.INITIAL;
  const out = [];
  for (const line of lines) {
    const res = grammar.tokenizeLine(line, ruleStack);
    ruleStack = res.ruleStack;
    out.push(`>${line}`);
    for (const t of res.tokens) {
      const text = line.slice(t.startIndex, t.endIndex);
      if (!text.trim()) continue;
      // Drop the shared source.python root scope to keep snapshots readable.
      const scopes = t.scopes.filter((s) => s !== "source.python");
      out.push(`  ${JSON.stringify(text)} : ${scopes.join(" ")}`);
    }
  }
  return out.join("\n") + "\n";
}

const grammar = await registry.loadGrammar("source.python");
const fixturesDir = path.join(root, "fixtures");
const snapDir = path.join(dir, "snapshots");
mkdirSync(snapDir, { recursive: true });

const { readdirSync } = await import("node:fs");
const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".py"));

let failed = 0;
for (const f of files) {
  const actual = tokenizeFile(
    grammar,
    readFileSync(path.join(fixturesDir, f), "utf8")
  );
  const snapPath = path.join(snapDir, f + ".snap");
  if (update || !existsSync(snapPath)) {
    writeFileSync(snapPath, actual);
    console.log(`updated ${f}.snap`);
  } else {
    const expected = readFileSync(snapPath, "utf8");
    if (expected !== actual) {
      failed++;
      console.error(`FAIL ${f} — snapshot mismatch`);
      const e = expected.split("\n");
      const a = actual.split("\n");
      for (let i = 0; i < Math.max(e.length, a.length); i++) {
        if (e[i] !== a[i]) {
          console.error(`  first diff at line ${i + 1}:`);
          console.error(`    expected: ${e[i]}`);
          console.error(`    actual:   ${a[i]}`);
          break;
        }
      }
    } else {
      console.log(`ok ${f}`);
    }
  }
}
if (failed) {
  console.error(`${failed} snapshot(s) failed`);
  process.exit(1);
}
