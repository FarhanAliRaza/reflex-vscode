// Virtual-document support for request forwarding, adapted from the
// lsp-embedded-request-forwarding sample (MIT, Microsoft): the embedded
// region keeps its exact offsets and everything else is blanked to
// whitespace, so positions map 1:1 between the Python doc and the virtual doc.
import type { Region } from "./regions";

export const SCHEME = "reflex-embedded";

export const LANGUAGE_EXT: Record<string, string> = {
  javascript: "js",
  javascriptreact: "jsx",
  typescript: "ts",
  html: "html",
  css: "css",
};

/**
 * Replace every character outside the region (and inside f-string
 * placeholders) with spaces, preserving newlines.
 */
export function blankOutside(text: string, region: Region): string {
  const chars = new Array<string>(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const inRegion =
      i >= region.start &&
      i < region.end &&
      !region.placeholders.some((p) => i >= p.start && i < p.end);
    chars[i] = inRegion || ch === "\n" || ch === "\r" ? ch : " ";
  }
  return chars.join("");
}

/** Virtual URI for a host document + embedded language. */
export function virtualUriString(originalUri: string, language: string): string {
  const ext = LANGUAGE_EXT[language];
  return `${SCHEME}://${ext}/${encodeURIComponent(originalUri)}.${ext}`;
}
