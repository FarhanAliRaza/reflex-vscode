import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { regionAt, scanRegions, type Region } from "../src/regions";

const fixturesDir = path.join(__dirname, "..", "fixtures");

function fixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

function textOf(src: string, r: Region): string {
  return src.slice(r.start, r.end);
}

describe("string-arg contexts", () => {
  it("finds js in call_script/run_script/call_function/Var/script", () => {
    const src = fixture("raw_js.py");
    const js = scanRegions(src).filter((r) => r.language === "javascript");
    const texts = js.map((r) => textOf(src, r));
    expect(texts).toContain("playFromStart(button_sfx)");
    expect(texts).toContain("window.location");
    expect(texts).toContain("window.scrollTo({top: 0, behavior: 'smooth'})");
    expect(texts).toContain("() => window.confirm('sure?')");
    expect(texts).toContain("((edge) => edge.id !== 'e1')");
    // both Var(_js_expr=...) and bare Var("...") forms
    expect(
      texts.filter((t) => t === "{...searchBarProps}").length
    ).toBe(2);
    expect(texts).toContain("console.log('inline javascript')");
    expect(texts.some((t) => t.includes("var button_sfx = new Audio"))).toBe(
      true
    );
  });

  it("handles multi-line calls (string on the next line)", () => {
    const src = 'x = rx.call_script(\n    """document.title"""\n)\n';
    const [r] = scanRegions(src);
    expect(r.language).toBe("javascript");
    expect(textOf(src, r)).toBe("document.title");
  });

  it("handles escaped quotes", () => {
    const src = `y = rx.call_script("alert('a\\'b')")\n`;
    const [r] = scanRegions(src);
    expect(textOf(src, r)).toBe("alert('a\\'b')");
  });

  it("finds html in rx.html", () => {
    const src = fixture("raw_html.py");
    const html = scanRegions(src).filter((r) => r.language === "html");
    expect(html.length).toBe(2);
    expect(textOf(src, html[0])).toBe("<h2>Hello World</h2>");
    expect(textOf(src, html[1])).toContain('<img src="/logo.png"');
  });
});

describe("css contexts", () => {
  const src = fixture("inline_css.py");
  const regions = scanRegions(src);

  it("finds style dict keys as css-property regions", () => {
    const keys = regions
      .filter((r) => r.language === "css-property")
      .map((r) => textOf(src, r));
    expect(keys).toContain("font_family");
    expect(keys).toContain("box_shadow");
    expect(keys).toContain("background_color");
    expect(keys).toContain("text_decoration");
    expect(keys).toContain("backgroundColor");
  });

  it("finds style dict values with their kebab-case property", () => {
    const values = regions.filter((r) => r.language === "css-value");
    const byText = new Map(values.map((r) => [textOf(src, r), r.cssProperty]));
    expect(byText.get("Comic Sans MS")).toBe("font-family");
    expect(byText.get("lightblue")).toBe("background-color");
    expect(byText.get("underline")).toBe("text-decoration");
    expect(byText.get("red")).toBe("background-color"); // rx.Style camelCase key
  });

  it("finds css kwargs with property mapping", () => {
    const kwarg = regions.find((r) => r.cssProperty === "background-image");
    expect(kwarg).toBeDefined();
    expect(textOf(src, kwarg!)).toContain("linear-gradient");
    const fw = regions.find((r) => r.cssProperty === "font-weight");
    expect(fw && textOf(src, fw)).toBe("bold");
  });

  it("finds raw stylesheets in rx.el.style", () => {
    const sheet = regions.find((r) => r.language === "css");
    expect(sheet).toBeDefined();
    expect(textOf(src, sheet!)).toContain(".container { display: flex; }");
  });

  it("does not treat blocklisted kwargs (src/alt/size) as CSS", () => {
    const props = regions.map((r) => r.cssProperty);
    expect(props).not.toContain("src");
    expect(props).not.toContain("alt");
    expect(props).not.toContain("size");
  });

  it("maps kebab-case dict keys to their property", () => {
    const dictSrc = 'x = rx.box(style={"box-shadow": "0 2px 0 0 #FFF inset"})\n';
    const value = scanRegions(dictSrc).find((r) => r.language === "css-value");
    expect(value?.cssProperty).toBe("box-shadow");
  });
});

describe("class_name context", () => {
  it("marks string and list forms as tailwind", () => {
    const src = fixture("tailwind_classes.py");
    const tw = scanRegions(src).filter((r) => r.language === "tailwind");
    const texts = tw.map((r) => textOf(src, r));
    expect(texts).toContain("text-4xl text-center text-blue-500");
    expect(texts).toContain("flex");
    expect(texts).toContain("items-center");
    expect(texts).toContain("mx-auto max-w-3xl");
    expect(texts.some((t) => t.startsWith("p-4 "))).toBe(true);
  });
});

describe("comment tags", () => {
  const src = fixture("comment_tags.py");
  const regions = scanRegions(src);

  it("tags via preceding # language=X comments", () => {
    const js = regions.filter((r) => r.language === "javascript");
    expect(js.some((r) => textOf(src, r).includes("addEventListener"))).toBe(
      true
    );
    expect(js.some((r) => textOf(src, r) === "document.querySelector('#app')")
    ).toBe(true);
    const css = regions.filter((r) => r.language === "css");
    expect(css.some((r) => textOf(src, r).includes("--accent"))).toBe(true);
    const html = regions.filter((r) => r.language === "html");
    expect(html.some((r) => textOf(src, r).includes("<section>"))).toBe(true);
  });

  it("tags via first-line #js inside the string", () => {
    const inline = regions.find(
      (r) => r.language === "javascript" && textOf(src, r).includes("answer")
    );
    expect(inline).toBeDefined();
    // Content starts after the tag.
    expect(textOf(src, inline!)).not.toContain("#js");
  });

  it("does not tag ordinary comments/strings", () => {
    const all = regions.map((r) => textOf(src, r)).join("\n");
    expect(all).not.toContain("plain python string");
  });
});

describe("method bodies", () => {
  it("marks strings in add_hooks/add_custom_code/_get_custom_code as jsx", () => {
    const src = fixture("custom_component.py");
    const jsx = scanRegions(src).filter(
      (r) => r.language === "javascriptreact"
    );
    const texts = jsx.map((r) => textOf(src, r));
    expect(texts.some((t) => t.includes("useEffect"))).toBe(true);
    expect(texts.some((t) => t.includes("const customHookVariable"))).toBe(
      true
    );
    expect(texts.some((t) => t.includes("<div className="))).toBe(true);
    expect(texts).toContain("import 'reactflow/dist/style.css';");
  });

  it("skips the docstring", () => {
    const src = fixture("custom_component.py");
    const jsx = scanRegions(src).filter(
      (r) => r.language === "javascriptreact"
    );
    expect(
      jsx.some((r) => textOf(src, r).includes("Add the hooks"))
    ).toBe(false);
  });
});

describe("tagged templates in embedded js", () => {
  const src = fixture("js_templates.py");
  const regions = scanRegions(src);

  it("finds /* css */ templates nested in add_hooks js", () => {
    const css = regions.find((r) => r.language === "css");
    expect(css).toBeDefined();
    expect(textOf(src, css!)).toContain(".ikp-search-bar__button");
    expect(textOf(src, css!)).toContain("border-radius: 0.5rem;");
  });

  it("finds /* html */ templates in call_script js", () => {
    const html = regions.find((r) => r.language === "html");
    expect(html).toBeDefined();
    expect(textOf(src, html!)).toBe('<div class="card"><p>hello</p></div>');
  });

  it("regionAt picks the innermost region and keeps ${} as js", () => {
    const css = regions.find((r) => r.language === "css")!;
    const inside = src.indexOf("border-radius");
    expect(regionAt(regions, inside)?.language).toBe("css");
    const ph = src.indexOf("${bg}") + 2;
    expect(regionAt(regions, ph)?.language).toBe("javascriptreact");
  });
});

describe("f-strings", () => {
  const src = fixture("fstrings.py");
  const regions = scanRegions(src);

  it("records placeholders and excludes them from regionAt", () => {
    const js = regions.find(
      (r) => r.language === "javascript" && r.fstring && textOf(src, r).includes("edge")
    );
    expect(js).toBeDefined();
    expect(js!.placeholders.length).toBe(1);
    const ph = js!.placeholders[0];
    expect(src.slice(ph.start, ph.end)).toBe("{node_id}");
    expect(regionAt(regions, ph.start + 2)).toBeUndefined();
    expect(regionAt(regions, js!.start + 1)?.language).toBe("javascript");
  });

  it("treats {{ }} as literals, not placeholders", () => {
    const js = regions.find(
      (r) => r.fstring && textOf(src, r).includes("scrollIntoView")
    );
    expect(js).toBeDefined();
    const phTexts = js!.placeholders.map((p) => src.slice(p.start, p.end));
    expect(phTexts).toEqual(["{node_id}"]);
  });
});
