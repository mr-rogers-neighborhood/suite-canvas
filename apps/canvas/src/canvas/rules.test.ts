import type { StyleRule, SurfaceStyle } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  CONTRAST_FLOOR,
  contrastRatio,
  mergeSurfaceStyle,
  resolveSurfaceStyleWithRules,
  type SurfacePalette,
  shellPaintFor,
  shellRegionPaintFor,
  surfacePaintFor,
} from "./rules";

function rule(overrides: Partial<StyleRule> & Pick<StyleRule, "id" | "scope">): StyleRule {
  return {
    name: overrides.id,
    order: 0,
    style: {},
    ...overrides,
  };
}

const card = { surface: "card", typeId: "note" } as const;
const project = { surface: "card", typeId: "project" } as const;

describe("named rules over roles", () => {
  it("should paint every card of the type a type rule names, and no other type", () => {
    const rules = [
      rule({ id: "notes-are-green", scope: { kind: "type", id: "note" }, style: { radius: 18 } }),
    ];

    expect(resolveSurfaceStyleWithRules(undefined, card, rules).style.radius).toBe(18);
    expect(resolveSurfaceStyleWithRules(undefined, card, rules).applied).toBe(true);
    expect(resolveSurfaceStyleWithRules(undefined, project, rules).applied).toBe(false);
    expect(resolveSurfaceStyleWithRules(undefined, project, rules).style.radius).toBeNull();
  });

  it("should apply a global rule everywhere", () => {
    const rules = [
      rule({ id: "everywhere", scope: { kind: "global" }, style: { textScale: 1.2 } }),
    ];

    expect(resolveSurfaceStyleWithRules(undefined, card, rules).style.textScale).toBe(1.2);
    expect(resolveSurfaceStyleWithRules(undefined, project, rules).style.textScale).toBe(1.2);
    expect(
      resolveSurfaceStyleWithRules(undefined, { surface: "section" }, rules).style.textScale,
    ).toBe(1.2);
    expect(
      resolveSurfaceStyleWithRules(undefined, { surface: "board" }, rules).style.textScale,
    ).toBe(1.2);
  });

  it("should let the more specific scope win over the global one", () => {
    const rules = [
      rule({ id: "global", scope: { kind: "global" }, style: { surface: "canvas" } }),
      rule({ id: "kind", scope: { kind: "kind", id: "card" }, style: { ink: "accent" } }),
      rule({
        id: "type",
        scope: { kind: "type", id: "note" },
        style: { surface: "surface-strong" },
      }),
    ];

    const resolved = resolveSurfaceStyleWithRules(undefined, card, rules).style;
    // Nothing more specific than the type rule names the surface, so it stands.
    expect(resolved.surface).toBe("surface-strong");
    // The kind rule still contributes the field the type rule left alone.
    expect(resolved.ink).toBe("accent");
  });

  it("should order equally specific rules by their order, later winning", () => {
    const rules = [
      rule({ id: "first", order: 0, scope: { kind: "type", id: "note" }, style: { radius: 4 } }),
      rule({ id: "second", order: 1, scope: { kind: "type", id: "note" }, style: { radius: 9 } }),
    ];

    expect(resolveSurfaceStyleWithRules(undefined, card, rules).style.radius).toBe(9);
  });

  it("should let a surface's own style beat every rule, however specific", () => {
    const rules = [
      rule({ id: "type", scope: { kind: "type", id: "note" }, style: { surface: "danger" } }),
    ];
    const own: SurfaceStyle = { surface: "success", radius: 3 };

    const resolved = resolveSurfaceStyleWithRules(own, card, rules).style;
    expect(resolved.surface).toBe("success");
    expect(resolved.radius).toBe(3);
  });

  it("should keep per-side edges from a rule when the style names a different side", () => {
    const rules = [
      rule({
        id: "dashed-top",
        scope: { kind: "global" },
        style: { sides: { top: { paint: "dashed", width: 2 } } },
      }),
    ];
    const own: SurfaceStyle = { sides: { bottom: { paint: "dotted" } } };

    const merged = mergeSurfaceStyle(rules[0]?.style ?? {}, own);
    expect(merged.sides?.top).toEqual({ paint: "dashed", width: 2 });
    expect(merged.sides?.bottom).toEqual({ paint: "dotted" });
  });

  it("should report nothing for a surface no rule names", () => {
    const resolved = resolveSurfaceStyleWithRules(undefined, card, []);
    expect(resolved.applied).toBe(false);
    expect(surfacePaintFor(undefined, card, { rules: [], palette: {} }).paint).toEqual({});
  });

  it("should paint a card a rule names through the shared paint variables", () => {
    const rules = [
      rule({
        id: "notes",
        scope: { kind: "type", id: "note" },
        style: { surface: "surface-strong" },
      }),
    ];
    const { paint, corrections } = surfacePaintFor(undefined, card, { rules, palette: {} });
    expect(paint["--paint-surface"]).toBe("var(--surface-strong)");
    expect(paint["--paint-ink"]).toBe("var(--ink)");
    // No palette to measure: nothing is claimed and nothing is corrected.
    expect(corrections).toEqual([]);
  });
});

describe("the contrast floor", () => {
  const palette: SurfacePalette = {
    surface: "#ffffff",
    "surface-strong": "#ffffff",
    ink: "#1d1d1f",
    "ink-muted": "#68686d",
    accent: "#0a84ff",
    canvas: "#f5f5f7",
  };

  it("should read WCAG ratios from hex pairs", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("rgba(0, 0, 0, 0.08)", "#ffffff")).toBeNull();
  });

  it("should correct and report ink a rule puts below the floor", () => {
    const rules = [
      rule({
        id: "washed-out",
        scope: { kind: "type", id: "note" },
        // A pale ink on a white surface: 1.14:1, far under the floor.
        style: { surface: "surface", ink: "surface-strong" },
      }),
    ];

    const resolved = resolveSurfaceStyleWithRules(undefined, card, rules, palette);
    expect(resolved.style.ink).not.toBe("surface-strong");
    expect(resolved.corrections).toHaveLength(1);
    const correction = resolved.corrections[0];
    expect(correction?.ruleId).toBe("washed-out");
    expect(correction?.ink).toBe("surface-strong");
    expect(correction?.corrected).toBe(resolved.style.ink);
    expect(correction?.floor).toBe(CONTRAST_FLOOR);
    expect(correction?.ratio).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });

  it("should leave a legible pair exactly as the rule wrote it", () => {
    const rules = [
      rule({
        id: "readable",
        scope: { kind: "type", id: "note" },
        style: { surface: "surface", ink: "ink" },
      }),
    ];

    const resolved = resolveSurfaceStyleWithRules(undefined, card, rules, palette);
    expect(resolved.style.ink).toBe("ink");
    expect(resolved.corrections).toEqual([]);
  });

  it("should stay out of the way when the palette cannot resolve a role", () => {
    const rules = [
      rule({
        id: "unreadable",
        scope: { kind: "global" },
        style: { surface: "surface", ink: "surface-strong" },
      }),
    ];

    // No palette at all: nothing to measure, so nothing is claimed or corrected.
    expect(resolveSurfaceStyleWithRules(undefined, card, rules).corrections).toEqual([]);
    // A seamless surface has no background to measure against.
    const seamless = resolveSurfaceStyleWithRules(
      undefined,
      card,
      [
        rule({
          id: "seamless",
          scope: { kind: "global" },
          style: { surface: "none", ink: "warning" },
        }),
      ],
      palette,
    );
    expect(seamless.corrections).toEqual([]);
  });
});

describe("the shell's own paint", () => {
  it("should write nothing at all when the workspace names no shell style", () => {
    expect(shellPaintFor(undefined, [], {})).toEqual({ vars: {}, fields: "" });
  });

  it("should prefix its variables so a card inside the shell cannot inherit them", () => {
    const { vars, fields } = shellPaintFor(
      { surface: "surface-strong", sides: { top: { paint: "dotted" } } },
      [],
      {},
    );

    expect(Object.keys(vars).every((name) => name.startsWith("--shell-paint-"))).toBe(true);
    expect(vars["--shell-paint-surface"]).toBe("var(--surface-strong)");
    expect(vars["--shell-paint-border-top"]).toBe("1px dotted var(--ink)");
    // Only what the style says, so the app bar keeps its translucency.
    expect(fields).toBe("surface sides");
  });

  it("should take a global rule as the shell's paint", () => {
    const rules = [
      rule({ id: "shell-ink", scope: { kind: "global" }, style: { ink: "accent", radius: 8 } }),
    ];
    const { fields } = shellPaintFor(undefined, rules, {});
    expect(fields).toBe("ink radius");
  });
});

/**
 * Shell regions ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md) amendment).
 *
 * A `shell` scope used to match no subject at all, so it was the same read-only fiction an unwritable `type`
 * rule was. The property that matters now: a region rule paints that region and leaves the others to the
 * shell-wide answer.
 */
describe("shellRegionPaintFor", () => {
  const palette = {
    surface: "#ffffff",
    canvas: "#f5f5f7",
    ink: "#1d1d1f",
    "ink-muted": "#68686d",
    accent: "#0a84ff",
  } as unknown as Parameters<typeof shellRegionPaintFor>[2];

  it("resolves every region, so the caller always has an answer", () => {
    const regions = shellRegionPaintFor(undefined, [], palette);
    expect(Object.keys(regions).sort()).toEqual(["app-bar", "dock", "drawer", "tabs"]);
    // Nothing named: no region claims a field, which is what keeps an untouched shell byte-identical.
    for (const paint of Object.values(regions)) expect(paint.fields).toBe("");
  });

  it("gives a region rule only to the region it names", () => {
    const regions = shellRegionPaintFor(
      undefined,
      [
        {
          id: "r-dock",
          name: "Every dock",
          order: 0,
          scope: { kind: "shell", id: "dock" },
          style: { surface: "accent" },
        },
      ],
      palette,
    );

    expect(regions.dock?.fields).toBe("surface");
    expect(regions.dock?.vars["--shell-dock-paint-surface"]).toBeDefined();
    // The other regions are untouched, and the variable is region-prefixed so it cannot leak.
    expect(regions["app-bar"]?.fields).toBe("");
    expect(regions["app-bar"]?.vars).toEqual({});
  });

  it("keeps the workspace shell style as every region's base", () => {
    const regions = shellRegionPaintFor({ ink: "ink" }, [], palette);
    for (const paint of Object.values(regions)) expect(paint.fields).toBe("ink");
  });
});
