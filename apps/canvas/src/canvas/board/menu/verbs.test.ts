import { describe, expect, it, vi } from "vitest";
import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import type { BoardMenuContext } from "./types";
import { buildVerbMenu, ENTITY_VERBS, resolveMenuTarget, verbLabel, verbsFor } from "./verbs";

/**
 * One menu for every entity.
 *
 * A right-click resolves what it landed on and keeps the rows that serve it, so the
 * shape of the menu is the same everywhere and a thing that cannot be coloured has no
 * colour row. A press inside a multi-selection resolves to the whole selection.
 */
function makeContext(overrides: Record<string, unknown> = {}): BoardMenuContext {
  return {
    menu: { kind: "node", nodeId: "card-a", x: 10, y: 20, flowPosition: { x: 0, y: 0 } },
    selectedNodeIds: [],
    selectedSectionIds: [],
    selectedEdgeIds: [],
    canCreateContent: true,
    canManageSchema: false,
    canEditLayout: true,
    canCreateBoards: true,
    canManageTrash: true,
    canManageStructure: true,
    canManageLinks: true,
    boards: [],
    palette: [],
    cardsById: new Map(),
    sectionMembershipMap: new Map(),
    store: { getState: () => ({ addSelectedNodes: vi.fn() }) },
    workspace: { getEdge: () => undefined, getSection: () => ({ shrinkToFit: true }) },
    setSelectionColour: vi.fn(),
    openAppearance: vi.fn(),
    duplicateCards: vi.fn(),
    createSectionAt: vi.fn(),
    createViewAt: vi.fn(),
    createViewFromSelection: vi.fn(),
    createMediaAt: vi.fn(),
    arrangeSelection: vi.fn(),
    changeLayer: vi.fn(),
    changeLayerBulk: vi.fn(),
    unplaceSelected: vi.fn(),
    trashSelected: vi.fn(),
    requestShare: vi.fn(),
    otherBoards: () => [],
    ...overrides,
  } as unknown as BoardMenuContext;
}

const labels = (items: ContextMenuItem[]) => items.map((item) => item.label);
const byLabel = (items: ContextMenuItem[], label: string) =>
  items.find((item) => item.label === label);

describe("the entity menu", () => {
  it("offers one Appearance entry for the whole selection", () => {
    const items = buildVerbMenu(makeContext({ selectedNodeIds: ["card-a", "card-b", "card-c"] }));

    const appearance = byLabel(items, "Appearance\u2026");
    expect(appearance).toBeDefined();
    expect(appearance?.items).toBeUndefined();
  });

  it("opens the panel on every selected card, at the press", () => {
    const openAppearance = vi.fn();
    const items = buildVerbMenu(
      makeContext({ openAppearance, selectedNodeIds: ["card-a", "card-b", "card-c"] }),
    );

    byLabel(items, "Appearance\u2026")?.onSelect?.();

    expect(openAppearance).toHaveBeenCalledWith({
      kind: "card",
      id: "card-a",
      ids: ["card-a", "card-b", "card-c"],
      at: { x: 10, y: 20 },
    });
  });

  it("is absent for a reader who cannot edit layout", () => {
    const items = buildVerbMenu(
      makeContext({ canEditLayout: false, selectedNodeIds: ["card-a", "card-b"] }),
    );

    expect(byLabel(items, "Appearance\u2026")).toBeUndefined();
  });

  it("colors every selected card from the one palette row", () => {
    const setSelectionColour = vi.fn();
    const items = buildVerbMenu(
      makeContext({
        setSelectionColour,
        selectedNodeIds: ["card-a", "card-b"],
        palette: [{ id: "green", name: "Green", light: "#0f0", dark: "#0a0" }],
      }),
    );

    byLabel(items, "Colour")
      ?.swatches?.find((item) => item.label === "Green")
      ?.onSelect?.();

    expect(setSelectionColour).toHaveBeenCalledWith("green", {
      nodeIds: ["card-a", "card-b"],
      edgeIds: [],
      sectionIds: [],
    });
  });

  it("colours the whole selection when the press lands inside a mixed one", () => {
    const setSelectionColour = vi.fn();
    const items = buildVerbMenu(
      makeContext({
        setSelectionColour,
        menu: { kind: "section", sectionId: "section-1", x: 0, y: 0 },
        selectedNodeIds: ["card-a"],
        selectedSectionIds: ["section-1"],
        selectedEdgeIds: ["edge-a"],
        palette: [{ id: "green", name: "Green", light: "#0f0", dark: "#0a0" }],
      }),
    );

    byLabel(items, "Colour")
      ?.swatches?.find((item) => item.label === "Green")
      ?.onSelect?.();

    // One press, every kind: the target carries the whole selection and the command writes each
    // kind in its own field.
    expect(setSelectionColour).toHaveBeenCalledWith("green", {
      nodeIds: ["card-a"],
      edgeIds: ["edge-a"],
      sectionIds: ["section-1"],
    });
  });

  it("colours only what it landed on when the press is outside the selection", () => {
    const setSelectionColour = vi.fn();
    const items = buildVerbMenu(
      makeContext({
        setSelectionColour,
        menu: {
          kind: "node",
          nodeId: "card-b",
          x: 0,
          y: 0,
          flowPosition: { x: 0, y: 0 },
        },
        selectedNodeIds: ["card-a"],
        palette: [{ id: "green", name: "Green", light: "#0f0", dark: "#0a0" }],
      }),
    );

    byLabel(items, "Colour")
      ?.swatches?.find((item) => item.label === "Green")
      ?.onSelect?.();

    // The press names its own target: a right-click on an unselected card must not restyle the
    // selection it is not part of.
    expect(setSelectionColour).toHaveBeenCalledWith("green", {
      nodeIds: ["card-b"],
      edgeIds: [],
      sectionIds: [],
    });
  });

  it("offers Default to clear, for a frame as much as a card", () => {
    const setSelectionColour = vi.fn();
    const items = buildVerbMenu(
      makeContext({
        setSelectionColour,
        menu: { kind: "section", sectionId: "section-1", x: 0, y: 0 },
      }),
    );

    byLabel(items, "Colour")
      ?.swatches?.find((item) => item.label === "Default")
      ?.onSelect?.();

    expect(setSelectionColour).toHaveBeenCalledWith(null, {
      nodeIds: [],
      edgeIds: [],
      sectionIds: ["section-1"],
    });
  });

  it("gives a section the shared colour row and none of the card verbs", () => {
    const items = buildVerbMenu(
      makeContext({ menu: { kind: "section", sectionId: "section-1", x: 0, y: 0 } }),
    );

    expect(labels(items)).toContain("Colour");
    expect(labels(items)).toContain("Rename section");
    expect(labels(items)).toContain("Delete section");
    // A section is not a card: no duplicate, no position, no appearance panel.
    expect(labels(items)).not.toContain("Duplicate");
    expect(labels(items)).not.toContain("Position");
    expect(labels(items)).not.toContain("Appearance\u2026");
  });

  it("gives a link its own verbs and the shared appearance rows", () => {
    const items = buildVerbMenu(
      makeContext({
        menu: { kind: "edge", edgeId: "edge-1", x: 0, y: 0 },
        workspace: { getEdge: () => ({ id: "edge-1", path: "bezier" }) },
      }),
    );

    // Edit first, then how it looks, then how it runs, then what removes it.
    expect(labels(items)).toEqual([
      "Cut",
      "Copy",
      "Colour",
      "Appearance\u2026",
      "Add description\u2026",
      "Path",
      "Reverse direction",
      "Make bidirectional",
      "Delete link",
    ]);
  });

  it("offers a canvas press only the things a canvas can make", () => {
    const items = buildVerbMenu(makeContext({ menu: { kind: "canvas", x: 0, y: 0 } }));

    // Media is one door on every workspace; a view needs the schema capability as well, so it is
    // absent here and present in the test below.
    expect(labels(items)).toEqual([
      "New media…",
      "New card",
      "New sketch",
      "New section",
      "New portal",
    ]);
  });

  it("intersects when it is asked for several kinds at once", () => {
    // A card and a section both answer for a colour, a connector and a delete.
    expect(verbsFor(["card", "section"]).map((row) => row.id)).toEqual([
      "cut",
      "copy",
      "paste",
      "colour",
      "add-connector",
      "delete",
    ]);
    // A card and a link share the appearance rows and nothing else structural.
    expect(verbsFor(["card", "edge"]).map((row) => row.id)).toEqual([
      "cut",
      "copy",
      "paste",
      "colour",
      "appearance",
      "delete",
    ]);
    expect(verbsFor([])).toEqual([]);
  });

  it("resolves a multi-selection only when the press landed inside it", () => {
    const inside = resolveMenuTarget(makeContext({ selectedNodeIds: ["card-a", "card-b"] }));
    const outside = resolveMenuTarget(
      makeContext({
        selectedNodeIds: ["card-b", "card-c"],
        menu: { kind: "node", nodeId: "card-a", x: 0, y: 0 },
      }),
    );

    expect(inside?.ids).toEqual(["card-a", "card-b"]);
    expect(outside?.ids).toEqual(["card-a"]);
  });

  it("offers shrink to fit with checkbox on a section right click", () => {
    const toggleSectionShrinkToFit = vi.fn();
    const items = buildVerbMenu(
      makeContext({
        toggleSectionShrinkToFit,
        menu: { kind: "section", sectionId: "sec-1", x: 10, y: 10 },
      }),
    );
    const shrinkItem = byLabel(items, "Shrink to fit");
    expect(shrinkItem).toBeDefined();
    expect(shrinkItem?.checked).toBe(true);
    shrinkItem?.onSelect?.();
    expect(toggleSectionShrinkToFit).toHaveBeenCalledWith("sec-1");
  });
});

describe("the create group", () => {
  const canvasMenu = (overrides: Record<string, unknown> = {}) =>
    buildVerbMenu(
      makeContext({
        menu: { kind: "canvas", x: 0, y: 0, flowPosition: { x: 80, y: 40 } },
        ...overrides,
      }),
    );

  /**
   * The views rows are behind `views/availability.ts`, which is `false` in every build for now. When it
   * is turned back on these become the two tests that press the rows and assert the command ran.
   */
  it("should offer no view row while the views surfaces are shut", () => {
    const items = canvasMenu({
      canManageSchema: true,
      selectedNodeIds: ["c1", "c2"],
      createViewAt: vi.fn(),
      createViewFromSelection: vi.fn(),
    });

    // A row that makes a view card nobody can open would be a trap, so the whole group is absent.
    expect(byLabel(items, "New view")).toBeUndefined();
    expect(byLabel(items, "New view of this card")).toBeUndefined();
    expect(byLabel(items, "New view of these cards")).toBeUndefined();
  });

  it("should ask which kind of media at the press, rather than opening a list somewhere else", () => {
    const createMediaAt = vi.fn();
    const items = canvasMenu({ canCreateContent: true, createMediaAt });

    byLabel(items, "New media…")?.onSelect?.();
    // The picker lands a block in a card at this point, so the row hands over the point and not the library.
    expect(createMediaAt).toHaveBeenCalledWith({ x: 80, y: 40 });
  });

  it("should offer nothing that makes content to a session that cannot", () => {
    expect(labels(canvasMenu({ canCreateContent: false }))).toEqual([]);
  });

  /**
   * The palette and the panel buttons read a verb's words rather than writing them again: a label that
   * counts (`Duplicate 4 cards`) is the same string in the menu and in the palette, or the two drift.
   */
  it("names a verb from its own first item, so a surface that is not a menu can offer it", () => {
    const ctx = makeContext({ selectedNodeIds: ["card-a", "card-b"] });
    const target = {
      kind: "card" as const,
      ids: ["card-a", "card-b"],
      idsByKind: { cards: ["card-a", "card-b"], edges: [], sections: [] },
      anchor: "card-a",
    };
    const duplicate = ENTITY_VERBS.find((verb) => verb.id === "duplicate");
    expect(duplicate).toBeDefined();
    if (!duplicate) return;

    expect(verbLabel(ctx, target, duplicate)).toBe("Duplicate 2 cards");
  });

  it("gives the verbs a key runs the shortcut the palette prints", () => {
    const shortcuts = Object.fromEntries(
      ENTITY_VERBS.filter((verb) => verb.shortcut !== undefined).map((verb) => [
        verb.id,
        verb.shortcut,
      ]),
    );
    expect(shortcuts).toMatchObject({
      cut: "\u2318X",
      copy: "\u2318C",
      paste: "\u2318V",
      delete: "\u232b",
    });
  });
});
