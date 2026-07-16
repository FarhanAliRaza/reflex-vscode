# Changelog

## 0.1.5

Initial release.

- Syntax highlighting for CSS, JavaScript, JSX, TypeScript, and HTML embedded in Reflex Python strings.
- Completions and hovers in embedded code: CSS property names/values in-process, JS/HTML/JSX forwarded to VS Code's built-in language services via virtual documents.
- Tailwind CSS IntelliSense configuration for Reflex's `class_name` prop (string, list, and f-string forms).
- f-string placeholders keep Python highlighting and completions inside embedded regions.
- Comment tags (`# language=js`, `# css`, ...) to mark any string as embedded code.
- `Reflex: Show Embedded Regions in Active File` command for debugging region detection.
