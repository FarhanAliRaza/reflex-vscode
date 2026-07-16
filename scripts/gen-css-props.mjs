// Dumps the CSS property names known to vscode-css-languageservice into
// regions/css-properties.json as {kebab, snake} pairs. Consumed by
// syntaxes/generate.py (kwarg-trigger alternation) and src/cssData.ts.
import { getDefaultCSSDataProvider } from "vscode-css-languageservice";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const props = getDefaultCSSDataProvider()
  .provideProperties()
  .map((p) => p.name)
  // custom-property / vendor-prefix entries are not useful as Python kwargs
  .filter((n) => /^[a-z][a-z-]*$/.test(n))
  .sort();

const out = props.map((kebab) => ({ kebab, snake: kebab.replace(/-/g, "_") }));
writeFileSync(
  path.join(dir, "..", "regions", "css-properties.json"),
  JSON.stringify(out, null, 1) + "\n"
);
console.log(`wrote ${out.length} css properties`);
