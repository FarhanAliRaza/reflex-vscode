import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "dist/extension.js",
  external: ["vscode"],
  // Prefer ESM entry points: the UMD build of vscode-css-languageservice does
  // dynamic requires ('./parser/cssParser') that survive bundling and crash
  // at activation inside the extension host.
  mainFields: ["module", "main"],
  sourcemap: true,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
