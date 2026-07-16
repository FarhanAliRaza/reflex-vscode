// Minimal vscode API stub so the bundle can be load-tested outside VS Code.
class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind; } }
module.exports = {
  CompletionItem,
  CompletionItemKind: { Value: 11, Property: 9 },
  MarkdownString: class {}, SnippetString: class {}, Hover: class {},
  Uri: { parse: (s) => ({ toString: () => s }) },
  workspace: { getConfiguration: () => ({ get: (_k, d) => d }), registerTextDocumentContentProvider: () => ({ dispose(){} }), onDidCloseTextDocument: () => ({ dispose(){} }) },
  languages: { registerCompletionItemProvider: () => ({ dispose(){} }), registerHoverProvider: () => ({ dispose(){} }) },
  commands: { executeCommand: async () => undefined },
};
