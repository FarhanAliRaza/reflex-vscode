# Development

## Setup

```bash
pnpm install
pnpm gen            # regions.json -> syntaxes/*.tmLanguage.json (+ css props)
pnpm build          # esbuild -> dist/extension.js
pnpm test           # vitest: region scanner + css service unit tests
pnpm test:grammar   # tokenize fixtures/*.py, compare against snapshots
pnpm test:grammar:update   # rewrite snapshots after intended grammar changes
node scripts/sweep.mjs <file.py ...>        # dump detected regions of real files
node scripts/sweep.mjs --stats <dir>        # perf + counts over a codebase
pnpm package        # vsce -> reflex-vscode-*.vsix
```

Run/debug: open this folder in VS Code and press **F5** ("Launch Extension") — an Extension Development Host opens on `fixtures/workspace/`.

## Acknowledgements

- Injection-grammar approach adapted from [samwillis/python-inline-source](https://github.com/samwillis/python-inline-source) (MIT).
- Virtual-document request forwarding adapted from Microsoft's [lsp-embedded-request-forwarding](https://github.com/microsoft/vscode-extension-samples/tree/main/lsp-embedded-request-forwarding) sample (MIT).

## Architecture

`regions/regions.json` is the single source of truth. Two consumers:

- `syntaxes/generate.py` emits the injection grammars:
  - `reflex.injection` — the embedded-language contexts themselves.
  - `reflex-fstring.injection` — f-string placeholders inside embedded regions. Must be an injection to reach any nesting depth of the embedded language.
  - `reflex-methodbody.injection` — strings inside `add_hooks`-style method bodies, keyed on the scope the first grammar assigns to those bodies, for the same nesting reason.
- `src/regions.ts` scans documents at runtime for the completion/hover providers in `src/extension.ts`. JS/JSX/TS/HTML regions are forwarded to the installed providers through `reflex-embedded://` virtual documents whose offsets are identical to the Python document (everything outside the region is blanked to whitespace). CSS is answered in-process by `vscode-css-languageservice` (`src/cssInline.ts`): values via a synthesized `.x { prop: value }` document, dict keys from the CSS data set, converted to snake_case.

Method bodies (`add_hooks` etc.): the grammar scopes docstrings inside these methods as JSX (cosmetic). Regenerate with `python3 syntaxes/generate.py --no-method-body` to disable the whole context. The completion scanner does skip docstrings.

CSS-property kwargs are matched on *any* Python call — the extension cannot know a call is a Reflex component. `regions/regions.json` has a `kwargBlocklist` for names that clash with common non-CSS props (`src`, `alt`, `size`, `d`, `cx`, ...).

## ty semantic-token override

astral's [ty](https://github.com/astral-sh/ty) language server emits a `string` semantic token over every string literal (Pylance does not), and VS Code paints semantic tokens over TextMate scopes — erasing embedded highlighting a few seconds after a file opens. No setting can exempt one token type: `editor.semanticTokenColorCustomizations` rules silently ignore `false`, and the `semanticTokenScopes` contribution cannot beat the core default mapping.

The working fix that keeps ty fully functional is **`tools/ty-filter/`**: an LSP stdio proxy that forwards everything to the real ty binary but strips `string`-type entries from semantic-token responses (delta re-encoding included). Wire it per workspace:

```json
"ty.path": ["/path/to/reflex-vscode/tools/ty-filter/ty"]
```

Verify any ty upgrade with `node tools/ty-filter/test.mjs` — it runs the same LSP session raw vs. proxied and asserts only string tokens are removed.

## Manual test checklist (Extension Development Host)

1. Open `fixtures/tailwind_classes.py` — with Tailwind IntelliSense installed, typing in `class_name="fle|"` offers Tailwind classes with color swatches; ordinary Python strings offer nothing.
2. Open `fixtures/raw_js.py` — JS inside `rx.call_script("...")` is colorized ("Developer: Inspect Editor Tokens and Scopes" shows `meta.embedded.block.javascript`); typing `document.` inside offers JS member completions.
3. Open `fixtures/inline_css.py` — inside `"font_size": "|"` CSS value completions appear; hovering `solid`/`red` shows CSS docs; dict keys offer snake_case property names with documentation.
4. Open `fixtures/raw_html.py` — `<di|` completes HTML tags.
5. Open `fixtures/comment_tags.py` — `# language=js` strings highlight and complete as JS; `NOT_TAGGED` stays a plain Python string.
6. Open `fixtures/custom_component.py` — JSX in `add_custom_code` colorizes; `useEffect`/JSX attributes complete.

## Releasing

```bash
pnpm gen && pnpm build && pnpm test && pnpm test:grammar
pnpm package                                  # produces reflex-vscode-<version>.vsix
pnpm dlx @vscode/vsce publish --no-dependencies   # requires a Marketplace PAT
```
