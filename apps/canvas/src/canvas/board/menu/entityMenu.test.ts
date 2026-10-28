import { describe, expect, it, vi } from "vitest";
import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import { buildEntityMenu, menuRowsFor, resolveMenuTarget } from "./entityMenu";
import type { BoardMenuContext } from "./types";

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
    canCreateContent: true,
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
    workspace: { getEdge: () => undefined },
    setSwatches: vi.fn(),
    openAppearance: vi.fn(),
    duplicateCards: vi.fn(),
    createSectionAt: vi.fn(),
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
    const items = buildEntityMenu(makeContext({ selectedNodeIds: ["card-a", "card-b", "card-c"] }));

    const appearance = byLabel(items, "Appearance\u2026");
    expect(appearance).toBeDefined();
    expect(appearance?.items).toBeUndefined();
  });

  it("opens the panel on every selected card, at the press", () => {
    const openAppearance = vi.fn();
    const items = buildEntityMenu(
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
    const items = buildEntityMenu(
      makeContext({ canEditLayout: false, selectedNodeIds: ["card-a", "card-b"] }),
    );

    expect(byLabel(items, "Appearance\u2026")).toBeUndefined();
  });

  it("colors every selected card from the one palette row", () => {
    const setSwatches = vi.fn();
    const items = buildEntityMenu(
      makeContext({
        setSwatches,
        selectedNodeIds: ["card-a", "card-b"],
        palette: [{ id: "green", name: "Green", light: "#0f0", dark: "#0a0" }],
      }),
    );

    byLabel(items, "Colour")
      ?.items?.find((item) => item.label === "Green")
      ?.onSelect?.();

    expect(setSwatches).toHaveBeenCalledWith(["card-a", "card-b"], "green");
  });

  it("gives a section the shared colour row and none of the card verbs", () => {
    const items = buildEntityMenu(
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
    const items = buildEntityMenu(
      makeContext({
        menu: { kind: "edge", edgeId: "edge-1", x: 0, y: 0 },
        workspace: { getEdge: () => ({ id: "edge-1", path: "bezier" }) },
      }),
    );

    expect(labels(items)).toEqual([
      "Colour",
      "Appearance\u2026",
      "Add description\u2026",
      "Reverse direction",
      "Make bidirectional",
      "Path",
      "Delete link",
    ]);
  });

  it("offers a canvas press only the things a canvas can make", () => {
    const items = buildEntityMenu(makeContext({ menu: { kind: "canvas", x: 0, y: 0 } }));

    expect(labels(items)).toEqual(["New card", "New sketch", "New section", "New portal"]);
  });

  it("intersects when it is asked for several kinds at once", () => {
    // A card and a section both answer for a colour, a connector and a delete.
    expect(menuRowsFor(["card", "section"]).map((row) => row.id)).toEqual([
      "colour",
      "add-connector",
      "delete",
    ]);
    // A card and a link share the appearance rows and nothing else structural.
    expect(menuRowsFor(["card", "edge"]).map((row) => row.id)).toEqual([
      "colour",
      "appearance",
      "delete",
    ]);
    expect(menuRowsFor([])).toEqual([]);
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
});
