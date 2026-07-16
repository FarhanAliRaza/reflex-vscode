// End-to-end test: run the same LSP session against the raw ty server and
// against the proxy; assert the proxy output has no `string` tokens but is
// otherwise identical. Usage: node test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, globSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const realTy = globSync(
  path.join(
    process.env.HOME,
    ".vscode/extensions/astral-sh.ty-*/bundled/libs/bin/ty"
  )
).sort()
  .at(-1);
if (!realTy) throw new Error("no bundled ty found");

const project = mkdtempSync(path.join(os.tmpdir(), "tyfilter-"));
const pyFile = path.join(project, "app.py");
writeFileSync(
  pyFile,
  'import json\n\nscript = "console.log(1)"\n\n\ndef run(name: str) -> str:\n    return json.dumps({"key": name})\n'
);

function lspSession(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: project,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let buf = Buffer.alloc(0);
    const results = {};
    let legend;
    child.stdout.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const he = buf.indexOf("\r\n\r\n");
        if (he === -1) return;
        const m = /Content-Length:\s*(\d+)/i.exec(buf.subarray(0, he).toString());
        const len = Number(m[1]);
        if (buf.length < he + 4 + len) return;
        const msg = JSON.parse(buf.subarray(he + 4, he + 4 + len));
        buf = buf.subarray(he + 4 + len);
        if (msg.id === 1) {
          legend = msg.result.capabilities.semanticTokensProvider?.legend;
          send({ jsonrpc: "2.0", method: "initialized", params: {} });
          send({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                uri: `file://${pyFile}`,
                languageId: "python",
                version: 1,
                text: require_text(),
              },
            },
          });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/semanticTokens/full",
            params: { textDocument: { uri: `file://${pyFile}` } },
          });
        } else if (msg.id === 2) {
          results.data = msg.result?.data ?? [];
          results.legend = legend;
          child.kill();
          resolve(results);
        }
      }
    });
    child.on("error", reject);
    setTimeout(() => {
      child.kill();
      reject(new Error("timeout"));
    }, 20000);

    function send(msg) {
      const body = Buffer.from(JSON.stringify(msg));
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      child.stdin.write(body);
    }
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        processId: process.pid,
        rootUri: `file://${project}`,
        workspaceFolders: [{ uri: `file://${project}`, name: "t" }],
        capabilities: {
          textDocument: {
            semanticTokens: {
              requests: { full: true, range: true },
              tokenTypes: [],
              tokenModifiers: [],
              formats: ["relative"],
            },
          },
        },
      },
    });
  });
}

function require_text() {
  return 'import json\n\nscript = "console.log(1)"\n\n\ndef run(name: str) -> str:\n    return json.dumps({"key": name})\n';
}

function decode(data, legend) {
  const out = [];
  let line = 0;
  for (let i = 0; i < data.length; i += 5) {
    line += data[i];
    out.push(legend.tokenTypes[data[i + 3]]);
  }
  return out;
}

const raw = await lspSession(realTy, ["server"], {});
const proxied = await lspSession("node", [path.join(dir, "proxy.mjs"), "server"], {
  TY_FILTER_REAL_TY: realTy,
});

const rawTypes = decode(raw.data, raw.legend);
const proxTypes = decode(proxied.data, proxied.legend);
console.log("raw token types:    ", rawTypes.join(","));
console.log("proxied token types:", proxTypes.join(","));

const rawStrings = rawTypes.filter((t) => t === "string").length;
const proxStrings = proxTypes.filter((t) => t === "string").length;
const rawOther = rawTypes.filter((t) => t !== "string");
const proxOther = proxTypes;
if (rawStrings === 0) throw new Error("expected raw ty to emit string tokens");
if (proxStrings !== 0) throw new Error("proxy leaked string tokens");
if (JSON.stringify(rawOther) !== JSON.stringify(proxOther)) {
  throw new Error("proxy altered non-string tokens");
}
console.log(
  `PASS: raw had ${rawStrings} string tokens, proxy removed all, ${proxOther.length} other tokens preserved`
);
