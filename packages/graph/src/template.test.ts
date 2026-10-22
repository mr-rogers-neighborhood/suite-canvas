import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_TEMPLATE,
  DISPLAY_PRESETS,
  displayTemplate,
  MAX_TEMPLATE_LENGTH,
  normalizeTemplate,
  presetOf,
  renderTemplate,
  templateSegments,
} from "./template.js";

const context = { label: "Status", value: "In progress", card: "Beta", type: "Project" };

describe("templateSegments", () => {
  it("should split literal text from tokens", () => {
    expect(templateSegments("{{label}}: {{value}}")).toEqual([
      { kind: "label", text: "{{label}}" },
      { kind: "literal", text: ": " },
      { kind: "value", text: "{{value}}" },
    ]);
  });

  it("should accept spaces inside the braces", () => {
    expect(templateSegments("{{ value }}").map((segment) => segment.kind)).toEqual(["value"]);
  });

  it("should leave unknown tokens as literal text", () => {
    expect(templateSegments("{{nope}} {{value}}")).toEqual([
      { kind: "literal", text: "{{nope}} " },
      { kind: "value", text: "{{value}}" },
    ]);
  });

  it("should treat a lone brace as text", () => {
    expect(templateSegments("{value}")).toEqual([{ kind: "literal", text: "{value}" }]);
  });

  it("should return a single literal for plain text", () => {
    expect(templateSegments("just text")).toEqual([{ kind: "literal", text: "just text" }]);
  });
});

describe("renderTemplate", () => {
  it("should fill every token", () => {
    expect(renderTemplate("{{card}} / {{type}} / {{label}} / {{value}}", context)).toBe(
      "Beta / Project / Status / In progress",
    );
  });

  it("should show a placeholder for an empty value", () => {
    expect(renderTemplate("{{label}}: {{value}}", { ...context, value: "" })).toBe(
      "Status: \u2014",
    );
  });

  it("should keep the literal text when only the value is missing", () => {
    expect(renderTemplate("Status: {{value}}", { ...context, value: "" })).toBe("Status: \u2014");
  });

  it("should render an empty template as empty text", () => {
    expect(renderTemplate("", context)).toBe("");
  });
});

describe("displayTemplate", () => {
  it("should fall back to label and value", () => {
    expect(displayTemplate({})).toBe(DEFAULT_DISPLAY_TEMPLATE);
    expect(displayTemplate({ display: "   " })).toBe(DEFAULT_DISPLAY_TEMPLATE);
  });

  it("should prefer the stored template", () => {
    expect(displayTemplate({ display: "{{label}}: {{value}}" })).toBe("{{label}}: {{value}}");
  });
});

describe("presetOf", () => {
  it("should recognise each preset", () => {
    for (const [id, template] of Object.entries(DISPLAY_PRESETS)) {
      expect(presetOf(template)).toBe(id);
      expect(presetOf(`  ${template}  `)).toBe(id);
    }
  });

  it("should call anything else custom", () => {
    expect(presetOf("{{card}} — {{value}}")).toBe("custom");
  });
});

describe("normalizeTemplate", () => {
  it("should flatten and trim", () => {
    expect(normalizeTemplate("  {{label}}\n:   {{value}} \n")).toBe("{{label}} : {{value}}");
  });

  it("should treat blank input as a cleared style", () => {
    expect(normalizeTemplate("   ")).toBeNull();
    expect(normalizeTemplate(null)).toBeNull();
    expect(normalizeTemplate(undefined)).toBeNull();
  });

  it("should cap the length", () => {
    expect(normalizeTemplate("x".repeat(500))?.length).toBe(MAX_TEMPLATE_LENGTH);
  });
});
