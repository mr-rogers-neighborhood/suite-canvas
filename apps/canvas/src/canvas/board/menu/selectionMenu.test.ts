import { describe, expect, it, vi } from "vitest";
import { selectionMenuBranch } from "./nodeMenu";
import type { BoardMenuContext } from "./types";

/**
 * A multi-selection offers one panel, opened deliberately.
 *
 * It used to open on its own the moment a second card was picked, which covered the
 * board while the reader was still choosing. The entry is the option now.
 */
function context(overrides: Partial<BoardMenuContext> = {}): BoardMenuContext {
  return {
    menu: { kind: "node", nodeId: "card-a", x: 10, y: 20, flowPosition: { x: 0, y: 0 } },
    selectedNodeIds: ["card-a", "card-b", "card-c"],
    canCreateContent: true,
    canEditLayout: true,
    canManageTrash: true,
    canManageLinks: true,
    openAppearance: vi.fn(),
    duplicateCards: vi.fn(),
    createSectionAt: vi.fn(),
    arrangeSelection: vi.fn(),
    changeLayerBulk: vi.fn(),
    unplaceSelected: vi.fn(),
    trashSelected: vi.fn(),
    requestShare: vi.fn(),
    ...overrides,
  } as unknown as BoardMenuContext;
}

function itemNamed(items: ReturnType<typeof selectionMenuBranch>, label: string) {
  return (items ?? []).find((item) => item.label === label);
}

describe("the selection menu", () => {
  it("offers one Appearance entry for the whole selection", () => {
    const items = selectionMenuBranch(context());

    const appearance = itemNamed(items, "Appearance\u2026");
    expect(appearance).toBeDefined();
    expect(appearance && "items" in appearance).toBe(false);
  });

  it("opens the panel on every selected card, at the press", () => {
    const openAppearance = vi.fn();
    const items = selectionMenuBranch(context({ openAppearance }));

    const appearance = itemNamed(items, "Appearance\u2026");
    if (!appearance || !("onSelect" in appearance)) throw new Error("no appearance entry");
    appearance.onSelect();
    expect(openAppearance).toHaveBeenCalledWith({
      kind: "card",
      id: "card-a",
      ids: ["card-a", "card-b", "card-c"],
      at: { x: 10, y: 20 },
    });
  });

  it("is absent for a reader who cannot edit layout", () => {
    const items = selectionMenuBranch(context({ canEditLayout: false }));
    expect(itemNamed(items, "Appearance\u2026")).toBeUndefined();
  });
});
