// In-process CSS smarts via vscode-css-languageservice: value completions and
// hovers for style-dict values / CSS kwargs (synthesized `.x { prop: value }`
// documents), stylesheet completions for rx.el.style bodies, and snake_case
// property-name completions for style-dict keys.
import {
  getCSSLanguageService,
  getDefaultCSSDataProvider,
  type CompletionList as LspCompletionList,
  type Hover as LspHover,
} from "vscode-css-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";

const service = getCSSLanguageService();

export interface SimpleCompletion {
  label: string;
  /** LSP CompletionItemKind (1-based). */
  kind?: number;
  detail?: string;
  /** Markdown documentation. */
  documentation?: string;
  insertText?: string;
}

function toSimple(list: LspCompletionList): SimpleCompletion[] {
  return list.items.map((item) => ({
    label: item.label,
    kind: item.kind,
    detail: item.detail,
    documentation:
      typeof item.documentation === "string"
        ? item.documentation
        : item.documentation?.value,
    // Drop textEdits: their ranges refer to the synthetic document. VS Code
    // computes the replace range from the word at the cursor instead.
    insertText: item.textEdit?.newText ?? item.insertText,
  }));
}

function docFor(text: string): TextDocument {
  return TextDocument.create("css://synthetic/inline.css", "css", 1, text);
}

/** Completions for a property value, given the kebab-case property name. */
export function completeValue(
  property: string,
  valueText: string,
  offsetInValue: number
): SimpleCompletion[] {
  const head = `.x { ${property}: `;
  const doc = docFor(`${head}${valueText} }`);
  const pos = doc.positionAt(head.length + offsetInValue);
  const list = service.doComplete(doc, pos, service.parseStylesheet(doc));
  return toSimple(list);
}

/** Hover for a token inside a property value. */
export function hoverValue(
  property: string,
  valueText: string,
  offsetInValue: number
): string | undefined {
  const head = `.x { ${property}: `;
  const doc = docFor(`${head}${valueText} }`);
  const pos = doc.positionAt(head.length + offsetInValue);
  const hover = service.doHover(doc, pos, service.parseStylesheet(doc));
  return hoverToMarkdown(hover);
}

/** Completions inside a raw stylesheet (rx.el.style body, #css tags). */
export function completeStylesheet(
  cssText: string,
  offsetInCss: number
): SimpleCompletion[] {
  const doc = docFor(cssText);
  const list = service.doComplete(
    doc,
    doc.positionAt(offsetInCss),
    service.parseStylesheet(doc)
  );
  return toSimple(list);
}

/** Hover inside a raw stylesheet. */
export function hoverStylesheet(
  cssText: string,
  offsetInCss: number
): string | undefined {
  const doc = docFor(cssText);
  const hover = service.doHover(
    doc,
    doc.positionAt(offsetInCss),
    service.parseStylesheet(doc)
  );
  return hoverToMarkdown(hover);
}

function hoverToMarkdown(hover: LspHover | null): string | undefined {
  if (!hover) return undefined;
  const c = hover.contents;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => (typeof p === "string" ? p : p.value))
      .filter(Boolean)
      .join("\n\n");
  }
  return c.value;
}

interface PropertyItem {
  snake: string;
  kebab: string;
  documentation?: string;
}

let propertyCache: PropertyItem[] | undefined;

/** snake_case CSS property names (for style-dict key completions). */
export function propertyItems(): PropertyItem[] {
  if (!propertyCache) {
    propertyCache = getDefaultCSSDataProvider()
      .provideProperties()
      .filter((p) => /^[a-z][a-z-]*$/.test(p.name))
      .map((p) => ({
        snake: p.name.replace(/-/g, "_"),
        kebab: p.name,
        documentation:
          typeof p.description === "string"
            ? p.description
            : p.description?.value,
      }));
  }
  return propertyCache;
}

/** Hover text for a style-dict key (snake_case or camelCase property). */
export function hoverProperty(key: string): string | undefined {
  const kebab = key
    .replace(/_/g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
  const item = propertyItems().find((p) => p.kebab === kebab);
  return item?.documentation && `**${item.kebab}**\n\n${item.documentation}`;
}
