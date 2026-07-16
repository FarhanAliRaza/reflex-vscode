// Reflex Embedded Languages: completions + hovers inside embedded CSS/JS/JSX/
// HTML strings in Reflex Python code. Highlighting is contributed
// declaratively by the generated injection grammars; Tailwind completions are
// contributed by configurationDefaults for Tailwind CSS IntelliSense.
import * as vscode from "vscode";
import {
  completeStylesheet,
  completeValue,
  hoverProperty,
  hoverStylesheet,
  hoverValue,
  propertyItems,
  type SimpleCompletion,
} from "./cssInline";
import { regionAt, scanRegions, type Region } from "./regions";
import { blankOutside, virtualUriString } from "./virtualDocs";

const FORWARDED = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "html",
]);

const regionCache = new Map<string, { version: number; regions: Region[] }>();
const virtualContents = new Map<string, string>();

function getRegions(doc: vscode.TextDocument): Region[] {
  const key = doc.uri.toString();
  const cached = regionCache.get(key);
  if (cached && cached.version === doc.version) {
    return cached.regions;
  }
  const regions = scanRegions(doc.getText());
  regionCache.set(key, { version: doc.version, regions });
  return regions;
}

function enabled(): boolean {
  return vscode.workspace
    .getConfiguration("reflex.embedded")
    .get<boolean>("enableCompletions", true);
}

function toVscodeItems(items: SimpleCompletion[]): vscode.CompletionItem[] {
  return items.map((i) => {
    const item = new vscode.CompletionItem(
      i.label,
      i.kind !== undefined
        ? ((i.kind - 1) as vscode.CompletionItemKind)
        : vscode.CompletionItemKind.Value
    );
    item.detail = i.detail;
    if (i.documentation) {
      item.documentation = new vscode.MarkdownString(i.documentation);
    }
    if (i.insertText && !i.insertText.includes("$")) {
      item.insertText = i.insertText;
    } else if (i.insertText) {
      item.insertText = new vscode.SnippetString(i.insertText);
    }
    return item;
  });
}

async function forwardCompletion(
  doc: vscode.TextDocument,
  position: vscode.Position,
  region: Region,
  triggerCharacter: string | undefined
): Promise<vscode.CompletionList | undefined> {
  const originalUri = doc.uri.toString(true);
  virtualContents.set(originalUri, blankOutside(doc.getText(), region));
  const vdocUri = vscode.Uri.parse(virtualUriString(originalUri, region.language));
  // Offsets are identical between the python doc and the virtual doc, so the
  // position (and any ranges in the returned items) map 1:1.
  return vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    vdocUri,
    position,
    triggerCharacter
  );
}

async function forwardHover(
  doc: vscode.TextDocument,
  position: vscode.Position,
  region: Region
): Promise<vscode.Hover | undefined> {
  const originalUri = doc.uri.toString(true);
  virtualContents.set(originalUri, blankOutside(doc.getText(), region));
  const vdocUri = vscode.Uri.parse(virtualUriString(originalUri, region.language));
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    vdocUri,
    position
  );
  return hovers?.[0];
}

const completionProvider: vscode.CompletionItemProvider = {
  async provideCompletionItems(doc, position, _token, context) {
    if (!enabled()) return undefined;
    const offset = doc.offsetAt(position);
    const region = regionAt(getRegions(doc), offset);
    if (!region) return undefined;

    if (FORWARDED.has(region.language)) {
      return forwardCompletion(doc, position, region, context.triggerCharacter);
    }
    const text = doc.getText();
    if (region.language === "css") {
      return toVscodeItems(
        completeStylesheet(
          text.slice(region.start, region.end),
          offset - region.start
        )
      );
    }
    if (region.language === "css-value" && region.cssProperty) {
      return toVscodeItems(
        completeValue(
          region.cssProperty,
          text.slice(region.start, region.end),
          offset - region.start
        )
      );
    }
    if (region.language === "css-property") {
      return propertyItems().map((p) => {
        const item = new vscode.CompletionItem(
          p.snake,
          vscode.CompletionItemKind.Property
        );
        item.detail = p.kebab;
        if (p.documentation) {
          item.documentation = new vscode.MarkdownString(p.documentation);
        }
        return item;
      });
    }
    return undefined; // tailwind regions: Tailwind CSS IntelliSense owns them
  },
};

const hoverProvider: vscode.HoverProvider = {
  async provideHover(doc, position) {
    if (!enabled()) return undefined;
    const offset = doc.offsetAt(position);
    const region = regionAt(getRegions(doc), offset);
    if (!region) return undefined;

    if (FORWARDED.has(region.language)) {
      return forwardHover(doc, position, region);
    }
    const text = doc.getText();
    let markdown: string | undefined;
    if (region.language === "css") {
      markdown = hoverStylesheet(
        text.slice(region.start, region.end),
        offset - region.start
      );
    } else if (region.language === "css-value" && region.cssProperty) {
      markdown = hoverValue(
        region.cssProperty,
        text.slice(region.start, region.end),
        offset - region.start
      );
    } else if (region.language === "css-property") {
      markdown = hoverProperty(text.slice(region.start, region.end));
    }
    return markdown
      ? new vscode.Hover(new vscode.MarkdownString(markdown))
      : undefined;
  },
};

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [
    { language: "python", scheme: "file" },
    { language: "python", scheme: "untitled" },
  ];
  const channel = vscode.window.createOutputChannel("Reflex Embedded");
  const version = context.extension.packageJSON.version;
  channel.appendLine(
    `activated v${version} from ${context.extension.extensionPath}`
  );
  context.subscriptions.push(
    channel,
    vscode.commands.registerCommand("reflex.showEmbeddedRegions", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        channel.appendLine("no active editor");
        return;
      }
      const doc = editor.document;
      channel.appendLine(`--- v${version} regions for ${doc.uri.fsPath}`);
      if (doc.languageId !== "python") {
        channel.appendLine(`languageId is '${doc.languageId}', not python`);
      }
      const regions = scanRegions(doc.getText());
      for (const r of regions) {
        const preview = doc
          .getText()
          .slice(r.start, Math.min(r.end, r.start + 60))
          .replace(/\n/g, "\\n");
        channel.appendLine(
          `  [${r.language}${r.cssProperty ? ":" + r.cssProperty : ""}] L${
            doc.positionAt(r.start).line + 1
          } ${preview}`
        );
      }
      channel.appendLine(`  (${regions.length} regions)`);
      channel.show(true);
    }),
    vscode.workspace.registerTextDocumentContentProvider("reflex-embedded", {
      provideTextDocumentContent: (uri) => {
        const originalUri = decodeURIComponent(
          uri.path.slice(1).replace(/\.[a-z]+$/, "")
        );
        return virtualContents.get(originalUri);
      },
    }),
    vscode.languages.registerCompletionItemProvider(
      selector,
      completionProvider,
      ".",
      ":",
      "<",
      '"',
      "'",
      " ",
      "-",
      "/",
      "("
    ),
    vscode.languages.registerHoverProvider(selector, hoverProvider),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      regionCache.delete(doc.uri.toString());
      virtualContents.delete(doc.uri.toString(true));
    })
  );
}

export function deactivate(): void {
  regionCache.clear();
  virtualContents.clear();
}
