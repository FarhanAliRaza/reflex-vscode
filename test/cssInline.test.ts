import { describe, expect, it } from "vitest";
import {
  completeStylesheet,
  completeValue,
  hoverProperty,
  hoverValue,
  propertyItems,
} from "../src/cssInline";

describe("css value completions", () => {
  it("completes font-size values", () => {
    const items = completeValue("font-size", "", 0);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("larger");
    expect(labels).toContain("smaller");
  });

  it("completes display values", () => {
    const labels = completeValue("display", "fl", 2).map((i) => i.label);
    expect(labels).toContain("flex");
  });

  it("hovers value keywords", () => {
    const md = hoverValue("border", "1px solid red", 6);
    expect(md).toBeTruthy();
  });
});

describe("stylesheet completions", () => {
  it("completes property names inside a rule", () => {
    const css = ".container { disp }";
    const labels = completeStylesheet(css, css.indexOf("disp") + 4).map(
      (i) => i.label
    );
    expect(labels).toContain("display");
  });
});

describe("property items", () => {
  it("provides snake_case names with docs", () => {
    const items = propertyItems();
    const fw = items.find((p) => p.snake === "font_weight");
    expect(fw).toBeDefined();
    expect(fw!.kebab).toBe("font-weight");
    expect(fw!.documentation).toBeTruthy();
  });

  it("hovers snake_case and camelCase keys", () => {
    expect(hoverProperty("font_weight")).toContain("font-weight");
    expect(hoverProperty("backgroundColor")).toContain("background-color");
  });
});
