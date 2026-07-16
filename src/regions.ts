// Embedded-region scanner driven by regions/regions.json — the same context
// table the TextMate grammar is generated from. Unlike the grammar, this
// scanner is not line-bound: a trigger may be followed by the string on a
// later line, so completions work where highlighting cannot.
// Pure module: no vscode imports (unit-tested with vitest).

import regionsConfig from "../regions/regions.json";
import cssProperties from "../regions/css-properties.json";

export interface Placeholder {
  start: number;
  end: number;
}

export interface Region {
  /** Offset of the string content start (after the opening quote). */
  start: number;
  /** Offset of the string content end (before the closing quote). */
  end: number;
  /**
   * "javascript" | "javascriptreact" | "typescript" | "css" | "html" for
   * whole-document embeds, "css-value" for style values (with cssProperty),
   * "css-property" for style-dict key strings, "tailwind" for class_name.
   */
  language: string;
  /** kebab-case CSS property a css-value region belongs to. */
  cssProperty?: string;
  fstring: boolean;
  /** f-string {expression} spans inside [start, end). */
  placeholders: Placeholder[];
}

const QUOTES = ['"""', "'''", '"', "'"];
const SNAKE_TO_KEBAB = new Map(
  (cssProperties as { kebab: string; snake: string }[]).map((p) => [
    p.snake,
    p.kebab,
  ])
);

interface StringLiteral {
  contentStart: number;
  contentEnd: number;
  /** Offset just past the closing quote (or end of text if unterminated). */
  afterEnd: number;
  fstring: boolean;
  placeholders: Placeholder[];
}

/**
 * Parse a Python string literal starting at `pos` (at the prefix or quote).
 * Returns null if `pos` does not start a string literal.
 */
export function parseStringLiteral(
  text: string,
  pos: number
): StringLiteral | null {
  const prefixMatch = /^[rRbBuUfF]{0,2}/.exec(text.slice(pos, pos + 2));
  const prefix = prefixMatch ? prefixMatch[0] : "";
  let quoteStart = pos + prefix.length;
  // The prefix regex may overconsume into the quote (e.g. `"` matched as prefix
  // chars is impossible, but a 1-char prefix before a quote is not) — re-align.
  while (quoteStart > pos && !isQuoteAt(text, quoteStart)) {
    quoteStart--;
  }
  const quote = QUOTES.find((q) => text.startsWith(q, quoteStart));
  if (!quote) {
    return null;
  }
  const fstring = /[fF]/.test(text.slice(pos, quoteStart));
  const contentStart = quoteStart + quote.length;
  const single = quote.length === 1;
  const placeholders: Placeholder[] = [];
  let i = contentStart;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (single && ch === "\n") {
      // Unterminated single-line string: stop at end of line.
      return { contentStart, contentEnd: i, afterEnd: i, fstring, placeholders };
    }
    if (text.startsWith(quote, i)) {
      return {
        contentStart,
        contentEnd: i,
        afterEnd: i + quote.length,
        fstring,
        placeholders,
      };
    }
    if (fstring && ch === "{") {
      if (text[i + 1] === "{") {
        i += 2;
        continue;
      }
      const phStart = i;
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        i++;
      }
      placeholders.push({ start: phStart, end: i });
      continue;
    }
    if (fstring && ch === "}" && text[i + 1] === "}") {
      i += 2;
      continue;
    }
    i++;
  }
  return {
    contentStart,
    contentEnd: text.length,
    afterEnd: text.length,
    fstring,
    placeholders,
  };
}

function isQuoteAt(text: string, pos: number): boolean {
  return text[pos] === '"' || text[pos] === "'";
}

function skipWs(text: string, pos: number): number {
  while (pos < text.length && /\s/.test(text[pos])) pos++;
  return pos;
}

function pushString(
  regions: Region[],
  lit: StringLiteral,
  language: string,
  cssProperty?: string
): void {
  regions.push({
    start: lit.contentStart,
    end: lit.contentEnd,
    language,
    cssProperty,
    fstring: lit.fstring,
    placeholders: lit.placeholders,
  });
}

/** Scan `trigger` matches, each followed by a string literal (any distance). */
function scanStringArg(
  text: string,
  trigger: string,
  language: string,
  regions: Region[]
): void {
  const re = new RegExp(trigger, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lit = parseStringLiteral(text, skipWs(text, m.index + m[0].length));
    if (lit) {
      pushString(regions, lit, language);
      re.lastIndex = lit.afterEnd;
    }
  }
}

/** CSS-property kwargs: width="100px", background_image=f"url({x})", ... */
function scanCssKwargs(
  text: string,
  blocklist: Set<string>,
  regions: Region[]
): void {
  const re = /\b([a-z][a-z_]*)\s*=(?!=)\s*(?=[rRbBuUfF]{0,2}["'])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (blocklist.has(m[1])) continue;
    const kebab = SNAKE_TO_KEBAB.get(m[1]);
    if (!kebab) continue;
    const lit = parseStringLiteral(text, skipWs(text, m.index + m[0].length));
    if (lit) {
      pushString(regions, lit, "css-value", kebab);
      re.lastIndex = lit.afterEnd;
    }
  }
}

/**
 * Walk a brace-balanced style dict, emitting css-property regions for key
 * strings and css-value regions for their string values. Nested dicts
 * (pseudo props, breakpoints) recurse with the same rules.
 */
function scanStyleDictBody(
  text: string,
  openBrace: number,
  regions: Region[]
): number {
  let i = openBrace + 1;
  let lastKey: string | undefined;
  let expectValue = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "}") {
      return i + 1;
    }
    if (ch === "{") {
      i = scanStyleDictBody(text, i, regions);
      expectValue = false;
      continue;
    }
    if (ch === "#") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (ch === ":") {
      expectValue = true;
      i++;
      continue;
    }
    if (ch === ",") {
      expectValue = false;
      lastKey = undefined;
      i++;
      continue;
    }
    if (isQuoteAt(text, i) || /[rRbBuUfF]/.test(ch)) {
      const lit = parseStringLiteral(text, i);
      if (lit) {
        if (expectValue) {
          const kebab = lastKey
            ? (SNAKE_TO_KEBAB.get(lastKey) ?? snakeToKebabLoose(lastKey))
            : undefined;
          pushString(regions, lit, "css-value", kebab);
          expectValue = false;
        } else {
          lastKey = text.slice(lit.contentStart, lit.contentEnd);
          pushString(regions, lit, "css-property");
        }
        i = lit.afterEnd;
        continue;
      }
    }
    i++;
  }
  return i;
}

/** Best-effort snake/camel/kebab to kebab for keys not in the property list. */
function snakeToKebabLoose(key: string): string | undefined {
  if (!/^[A-Za-z_-]+$/.test(key)) return undefined;
  return key
    .replace(/_/g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function scanStyleDicts(text: string, triggers: string[], regions: Region[]): void {
  for (const trigger of triggers) {
    const re = new RegExp(trigger, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const brace = skipWs(text, m.index + m[0].length);
      if (text[brace] === "{") {
        re.lastIndex = scanStyleDictBody(text, brace, regions);
      }
    }
  }
}

/** class_name="..." / class_name=[...] — marked tailwind, never forwarded. */
function scanClassNames(text: string, trigger: string, regions: Region[]): void {
  const re = new RegExp(trigger, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = skipWs(text, m.index + m[0].length);
    if (text[i] === "[") {
      i++;
      while (i < text.length && text[i] !== "]") {
        if (isQuoteAt(text, i) || /[rRbBuUfF]/.test(text[i])) {
          const lit = parseStringLiteral(text, i);
          if (lit) {
            pushString(regions, lit, "tailwind");
            i = lit.afterEnd;
            continue;
          }
        }
        i++;
      }
    } else {
      const lit = parseStringLiteral(text, i);
      if (lit) pushString(regions, lit, "tailwind");
    }
  }
}

/** '''#js ...''' — first-line tag inside a triple-quoted string. */
function scanInlineTags(
  text: string,
  tagLanguages: Record<string, string>,
  regions: Region[]
): void {
  const tagAlt = Object.keys(tagLanguages).join("|");
  const re = new RegExp(
    `[rRbBuUfF]{0,2}("""|''')[ \\t]*#[ \\t]*(${tagAlt})\\b`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lit = parseStringLiteral(text, m.index);
    if (lit) {
      // Content starts after the tag so the tag itself is not sent anywhere.
      const tagEnd = m.index + m[0].length;
      pushString(
        regions,
        { ...lit, contentStart: tagEnd },
        tagLanguages[m[2]]
      );
      re.lastIndex = lit.afterEnd;
    }
  }
}

/** `# language=js` (or `# js`) comment line tagging the next string literal. */
function scanPrecedingTags(
  text: string,
  tagLanguages: Record<string, string>,
  regions: Region[]
): void {
  const tagAlt = Object.keys(tagLanguages).join("|");
  const re = new RegExp(
    `^[ \\t]*#[ \\t]*(?:language\\s*=\\s*|lang[:=]\\s*)?(${tagAlt})[ \\t]*$`,
    "gm"
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = text.indexOf("\n", m.index);
    if (i === -1) break;
    i = skipWs(text, i + 1);
    // Optional `NAME = ` / `NAME: T = ` assignment prefix.
    const assign = /^[\w.]+\s*(?::[^=\n]+?)?\s*=\s*/.exec(text.slice(i, i + 200));
    if (assign) i += assign[0].length;
    const lit = parseStringLiteral(text, i);
    if (lit) pushString(regions, lit, tagLanguages[m[1]]);
  }
}

/** Every string inside add_hooks/add_custom_code/_get_custom_code bodies. */
function scanMethodBodies(
  text: string,
  methods: string[],
  language: string,
  regions: Region[]
): void {
  const re = new RegExp(`^([ \\t]*)def\\s+(?:${methods.join("|")})\\b`, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const indent = m[1].length;
    // Find the body extent: lines blank or indented deeper than the def.
    let lineStart = text.indexOf("\n", m.index) + 1;
    let bodyEnd = text.length;
    while (lineStart > 0 && lineStart < text.length) {
      const lineEnd = text.indexOf("\n", lineStart);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      if (line.trim() !== "" && line.search(/\S/) <= indent) {
        bodyEnd = lineStart;
        break;
      }
      if (lineEnd === -1) break;
      lineStart = lineEnd + 1;
    }
    let i = text.indexOf("\n", m.index) + 1;
    // A docstring — the first statement of the body — is documentation, not JS.
    let firstStatement = true;
    while (i > 0 && i < bodyEnd) {
      const ch = text[i];
      if (ch === "#") {
        const nl = text.indexOf("\n", i);
        i = nl === -1 ? bodyEnd : nl + 1;
        continue;
      }
      if (isQuoteAt(text, i) || (/[rRbBuUfF]/.test(ch) && isQuoteNear(text, i))) {
        const lit = parseStringLiteral(text, i);
        if (lit) {
          if (!firstStatement) {
            pushString(regions, lit, language);
          }
          firstStatement = false;
          i = lit.afterEnd;
          continue;
        }
      }
      if (!/\s/.test(ch)) {
        firstStatement = false;
      }
      i++;
    }
    re.lastIndex = bodyEnd;
  }
}

function isQuoteNear(text: string, pos: number): boolean {
  return (
    isQuoteAt(text, pos + 1) ||
    (/[rRbBuUfF]/.test(text[pos + 1] ?? "") && isQuoteAt(text, pos + 2))
  );
}

const JS_REGION_LANGUAGES = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
]);

/**
 * Tagged template literals inside embedded JS regions: a `/* css *​/` (or
 * html) comment before a backtick embeds the template content. `${...}`
 * substitutions are recorded as placeholders (they stay JavaScript).
 */
function scanTaggedTemplates(text: string, jsRegions: Region[]): Region[] {
  const out: Region[] = [];
  const re = /\/\*\s*(css|html)\s*\*\/\s*`/g;
  for (const jr of jsRegions) {
    re.lastIndex = jr.start;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && m.index < jr.end) {
      const contentStart = m.index + m[0].length;
      const placeholders: Placeholder[] = [];
      let i = contentStart;
      const limit = Math.min(text.length, jr.end);
      while (i < limit) {
        const ch = text[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === "`") break;
        if (ch === "$" && text[i + 1] === "{") {
          const start = i;
          let depth = 1;
          i += 2;
          while (i < limit && depth > 0) {
            if (text[i] === "{") depth++;
            else if (text[i] === "}") depth--;
            i++;
          }
          placeholders.push({ start, end: i });
          continue;
        }
        i++;
      }
      out.push({
        start: contentStart,
        end: i,
        language: m[1],
        fstring: jr.fstring,
        placeholders: [
          ...placeholders,
          ...jr.placeholders.filter(
            (p) => p.start >= contentStart && p.end <= i
          ),
        ],
      });
      re.lastIndex = i;
    }
  }
  return out;
}

interface Context {
  id: string;
  kind: string;
  trigger?: string;
  triggers?: string[];
  language?: string;
  methods?: string[];
}

/**
 * Scan a Python document for embedded-language regions.
 * Overlaps are resolved in regions.json context order (first claim wins).
 */
export function scanRegions(text: string): Region[] {
  const regions: Region[] = [];
  const cfg = regionsConfig as unknown as {
    pseudoProps: string[];
    kwargBlocklist: string[];
    tagLanguages: Record<string, string>;
    contexts: Context[];
  };
  const kwargBlocklist = new Set(cfg.kwargBlocklist);
  for (const ctx of cfg.contexts) {
    switch (ctx.kind) {
      case "string-arg":
        scanStringArg(text, ctx.trigger!, ctx.language!, regions);
        break;
      case "css-kwarg":
        scanCssKwargs(text, kwargBlocklist, regions);
        break;
      case "style-dict":
        scanStyleDicts(
          text,
          ctx.triggers!.map((t) =>
            t.replace("STYLE_PSEUDO_PROPS", cfg.pseudoProps.join("|"))
          ),
          regions
        );
        break;
      case "class-string":
        scanClassNames(text, ctx.trigger!, regions);
        break;
      case "tag-inline":
        scanInlineTags(text, cfg.tagLanguages, regions);
        break;
      case "tag-preceding":
        scanPrecedingTags(text, cfg.tagLanguages, regions);
        break;
      case "method-body":
        scanMethodBodies(text, ctx.methods!, ctx.language!, regions);
        break;
    }
  }
  // First claim wins, in regions.json context order (insertion order here):
  // drop regions overlapping one claimed by an earlier context.
  const result: Region[] = [];
  for (const r of regions) {
    if (!result.some((c) => r.start < c.end && c.start < r.end)) {
      result.push(r);
    }
  }
  // Tagged templates nest INSIDE js regions; regionAt picks the innermost.
  result.push(
    ...scanTaggedTemplates(
      text,
      result.filter((r) => JS_REGION_LANGUAGES.has(r.language))
    )
  );
  return result.sort((a, b) => a.start - b.start);
}

/**
 * The innermost region containing `offset`, or undefined. Offsets inside a
 * region's placeholders don't count as that region (an f-string {expr} is
 * Python; a template ${expr} belongs to the enclosing JS region).
 */
export function regionAt(regions: Region[], offset: number): Region | undefined {
  let best: Region | undefined;
  for (const r of regions) {
    if (
      offset >= r.start &&
      offset <= r.end &&
      !r.placeholders.some((p) => offset > p.start && offset < p.end) &&
      (!best || r.end - r.start < best.end - best.start)
    ) {
      best = r;
    }
  }
  return best;
}
