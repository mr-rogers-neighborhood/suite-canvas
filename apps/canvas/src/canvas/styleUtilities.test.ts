import { styleColourRoles, styleShapes } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  declaredStyle,
  inheritedValue,
  STYLE_UTILITIES,
  styleProvenance,
  withoutUtility,
} from "./styleUtilities";

/**
 * The style utilities (ADR-0071).
 *
 * Two properties matter more than any single value: **every utility declares a
 * fallback**, and **inheritance reports where it came from**. The first is what makes a
 * utility safe to remove; the second is what lets a control offer "Inherit" honestly
 * instead of showing a value nobody can account for.
 */
describe("the utility index", () => {
  it("gives every utility an owner chain that ends at a built-in default", () => {
    for (const utility of STYLE_UTILITIES) {
      expect(utility.rungs.length, utility.id).toBeGreaterThan(0);
      expect(utility.rungs.at(-1), utility.id).toBe("built-in");
      // No duplicate rungs: a ladder with a repeated step cannot be walked once.
      expect(new Set(utility.rungs).size, utility.id).toBe(utility.rungs.length);
    }
  });

  it("says what each surface utility writes, and that reader utilities write nothing", () => {
    for (const utility of STYLE_UTILITIES) {
      if (utility.scope === "surface") {
        expect(utility.writes, utility.id).not.toBeNull();
        // A surface utility reaches at least the surface's own style.
        expect(utility.rungs[0], utility.id).toBe("card");
      } else {
        // A reader preference is this device's business, never the document's.
        expect(utility.writes, utility.id).toBeNull();
        expect(utility.rungs, utility.id).toEqual(["built-in"]);
      }
    }
  });

  it("has one entry per id", () => {
    const ids = STYLE_UTILITIES.map((utility) => utility.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names colour and ink as role controls, so no utility can offer a hex", () => {
    for (const id of ["colour", "ink"] as const) {
      const utility = STYLE_UTILITIES.find((entry) => entry.id === id);
      expect(utility?.control).toBe("role");
    }
    // The roles the control offers are the schema's, not a second list.
    expect(styleColourRoles).toContain("surface");
    expect(styleShapes).toContain("rect");
  });
});

describe("styleProvenance", () => {
  const rule = (rung: "global" | "kind" | "type", label: string, style: object) => ({
    rung,
    label,
    style,
  });

  it("reports the built-in default when nothing states a value", () => {
    const provenance = styleProvenance({ style: undefined, rules: [], surface: "card" });

    expect(provenance.get("colour")).toMatchObject({ from: "built-in", label: "Default" });
    // The built-in default is resolved, not undefined: that is the end of the chain.
    expect(provenance.get("colour")?.value).toBe("surface");
  });

  it("lets a broader rule state a value and a narrower one overrule it", () => {
    const rules = [
      rule("global", "This workspace", { shape: "pill" }),
      rule("type", "Concept", { shape: "document" }),
    ];
    const provenance = styleProvenance({ style: undefined, rules, surface: "card" });

    // Least specific first, so the type's value is the one in effect and the one named.
    expect(provenance.get("shape")).toMatchObject({ from: "type", label: "Concept" });
    expect(provenance.get("shape")?.value).toBe("document");
    // A property only the global rule states still reports the global rung.
    const onlyGlobal = styleProvenance({
      style: undefined,
      rules: [rule("global", "This workspace", { radius: 6 })],
      surface: "card",
    });
    expect(onlyGlobal.get("radius")).toMatchObject({ from: "global", label: "This workspace" });
  });

  it("puts the surface's own style above every rule", () => {
    const rules = [rule("type", "Concept", { colour: "surface" })];
    const provenance = styleProvenance({
      style: { surface: "canvas" },
      rules,
      surface: "card",
    });

    expect(provenance.get("colour")).toMatchObject({ from: "card", value: "canvas" });
  });

  it("leaves reader utilities out of the ladder entirely", () => {
    const provenance = styleProvenance({ style: { radius: 4 }, rules: [], surface: "card" });

    // Density is this device's, so it is not something a document resolves.
    expect(provenance.has("density")).toBe(false);
    expect(provenance.has("motion")).toBe(false);
  });
});

describe("inheritance and removal", () => {
  const rules = [
    { rung: "type" as const, label: "Concept", style: { surface: "canvas" as const } },
  ];

  it("names the rung an Inherit would fall back to", () => {
    const inherited = inheritedValue(
      { style: { surface: "danger" }, rules, surface: "card" },
      "colour",
    );

    // Clearing the card's own colour does not leave nothing: it inherits the type's.
    expect(inherited).toMatchObject({ from: "type", label: "Concept", value: "canvas" });
  });

  it("removing a utility drops exactly that field and keeps the rest", () => {
    const style = { surface: "danger" as const, radius: 8 };
    const without = withoutUtility(style, "colour");

    expect(without).not.toHaveProperty("surface");
    expect(without.radius).toBe(8);
    // The original is untouched: a preview must never mutate the document's record.
    expect(style.surface).toBe("danger");
  });

  it("resolves every utility at every rung, with no undefined value", () => {
    // The promise the index makes: a utility is never in effect as `undefined`. Walk
    // the subject through each rung in turn and check the field is always defined.
    const all = STYLE_UTILITIES.filter((utility) => utility.scope === "surface");
    const rungRules = [
      { rung: "global" as const, label: "Workspace", style: { shape: "rect" as const } },
      { rung: "kind" as const, label: "Cards", style: { opacity: 0.8 } },
      { rung: "type" as const, label: "Concept", style: { radius: 6 } },
    ];
    const provenance = styleProvenance({ style: {}, rules: rungRules, surface: "card" });

    for (const utility of all) {
      const entry = provenance.get(utility.id);
      expect(entry, utility.id).toBeDefined();
      expect(entry?.value, utility.id).not.toBeUndefined();
      expect(entry?.from, utility.id).toMatch(/card|type|kind|global|built-in/);
    }
  });
});

describe("declaredStyle", () => {
  it("merges rules least-specific first, then the surface's own style", () => {
    const merged = declaredStyle({ radius: 2 }, [
      { style: { surface: "canvas" } },
      { style: { surface: "danger" } },
    ]);

    expect(merged).toMatchObject({ surface: "danger", radius: 2 });
  });
});
