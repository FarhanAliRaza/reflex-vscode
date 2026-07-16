// LSP pass-through proxy for the ty language server that removes `string`-type
// semantic tokens from responses. Everything else — diagnostics, hover,
// completions, all other semantic token types — flows through unchanged.
//
// Why: ty emits a `string` semantic token spanning every string literal;
// VS Code paints semantic tokens over TextMate scopes, which erases the
// Reflex extension's embedded CSS/JS highlighting inside those strings a few
// seconds after a file opens. Filtering just those tokens lets both coexist.
//
// Used via the `ty.path` VS Code setting pointing at the sibling `ty` script.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { globSync } from "node:fs";

function resolveRealTy() {
  const override = process.env.TY_FILTER_REAL_TY;
  if (override) return override;
  // Prefer the workspace venv (cwd is the workspace root when spawned by the
  // extension), then the ty extension's bundled binary, then PATH.
  const venvTy = path.join(process.cwd(), ".venv", "bin", "ty");
  if (existsSync(venvTy)) return venvTy;
  try {
    const candidates = globSync(
      path.join(
        process.env.HOME ?? "",
        ".vscode/extensions/astral-sh.ty-*/bundled/libs/bin/ty"
      )
    ).sort();
    if (candidates.length) return candidates[candidates.length - 1];
  } catch {
    // node < 22 has no fs.globSync; fall through to PATH.
  }
  return "ty";
}

const real = resolveRealTy();
const child = spawn(real, process.argv.slice(2), {
  stdio: ["pipe", "pipe", "inherit"],
});
child.on("exit", (code, signal) =>
  process.exit(code ?? (signal ? 1 : 0))
);
process.on("SIGTERM", () => child.kill("SIGTERM"));

let stringTypeIndex = -1;
const pendingMethods = new Map(); // request id -> method (client -> server)

/** Incremental Content-Length frame parser. */
function makeFrameReader(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buf.subarray(0, headerEnd).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        // Unparseable header: drop a byte to avoid an infinite loop.
        buf = buf.subarray(1);
        continue;
      }
      const len = Number(m[1]);
      const bodyStart = headerEnd + 4;
      if (buf.length < bodyStart + len) return;
      const body = buf.subarray(bodyStart, bodyStart + len);
      buf = buf.subarray(bodyStart + len);
      onMessage(body);
    }
  };
}

function writeFrame(stream, msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  stream.write(`Content-Length: ${body.length}\r\n\r\n`);
  stream.write(body);
}

/** Drop `string`-type entries from delta-encoded semantic token data. */
function filterTokenData(data) {
  const out = [];
  let absLine = 0;
  let absChar = 0;
  let prevLine = 0;
  let prevChar = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaStart = data[i + 1];
    absLine += deltaLine;
    absChar = deltaLine === 0 ? absChar + deltaStart : deltaStart;
    if (data[i + 3] === stringTypeIndex) continue;
    out.push(
      absLine - prevLine,
      absLine === prevLine ? absChar - prevChar : absChar,
      data[i + 2],
      data[i + 3],
      data[i + 4]
    );
    prevLine = absLine;
    prevChar = absChar;
  }
  return out;
}

// Client -> server: record request methods so responses can be matched.
const fromClient = makeFrameReader((body) => {
  try {
    const msg = JSON.parse(body);
    if (msg.id !== undefined && msg.method) {
      pendingMethods.set(msg.id, msg.method);
    }
  } catch {
    // Not JSON? Forward as-is.
  }
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
});
process.stdin.on("data", fromClient);
process.stdin.on("end", () => child.stdin.end());

// Server -> client: rewrite initialize + semantic token responses.
const fromServer = makeFrameReader((body) => {
  let msg;
  try {
    msg = JSON.parse(body);
  } catch {
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
    return;
  }
  const method =
    msg.id !== undefined && !msg.method ? pendingMethods.get(msg.id) : msg.method;
  if (msg.id !== undefined && !msg.method) pendingMethods.delete(msg.id);

  if (method === "initialize" && msg.result?.capabilities) {
    const st = msg.result.capabilities.semanticTokensProvider;
    if (st?.legend?.tokenTypes) {
      stringTypeIndex = st.legend.tokenTypes.indexOf("string");
      // Force full (non-delta) responses so filtering stays simple.
      if (st.full && typeof st.full === "object") st.full = true;
    }
  } else if (
    stringTypeIndex !== -1 &&
    (method === "textDocument/semanticTokens/full" ||
      method === "textDocument/semanticTokens/range") &&
    Array.isArray(msg.result?.data)
  ) {
    msg.result.data = filterTokenData(msg.result.data);
  }
  writeFrame(process.stdout, msg);
});
child.stdout.on("data", fromServer);
