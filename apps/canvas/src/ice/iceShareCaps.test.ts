import { describe, expect, it } from "vitest";
import { ICE_EDIT_CAPABILITIES, ICE_VIEW_CAPABILITIES } from "./iceBridge";
import {
  type IceShareCaps,
  type IceShareScopeInput,
  type IceShareUiCapabilities,
  iceShareCaps,
  visiblePinFilter,
  withinShareScope,
} from "./iceShareCaps";

type Scope = IceShareScopeInput["scope"];
type Role = IceShareScopeInput["role"];

const OWNER_UI: IceShareUiCapabilities = {
  readOnly: false,
  canEditLayout: true,
  canEditContent: true,
  canManageSchema: true,
  canManageTrash: true,
};

/** A permissive UI matrix, to prove a viewer share outranks whatever the shell holds. */
const PERMISSIVE_UI = OWNER_UI;

function share(
  scope: Scope,
  role: Role,
  ids: { boardId?: string | null; cardId?: string | null } = {},
): IceShareScopeInput {
  return { scope, role, ...ids };
}

function capsOf(shared: IceShareScopeInput | null, ui = OWNER_UI): IceShareCaps {
  return iceShareCaps({ share: shared, ui });
}

function writeFlags(caps: IceShareCaps): boolean[] {
  return [
    caps.canWriteLayout,
    caps.canDropPin,
    caps.canManagePins,
    caps.canCreateCards,
    caps.canEditContent,
    caps.canPublishDrag,
    caps.bridge.write,
  ];
}

describe("iceShareCaps — owner", () => {
  it("follows the UI matrix and receives the edit bridge", () => {
    const caps = capsOf(null);
    expect(caps.role).toBe("owner");
    expect(caps.controllerRole).toBe("owner");
    expect(caps.bridge).toBe(ICE_EDIT_CAPABILITIES);
    expect(caps.canWriteLayout).toBe(true);
    expect(caps.canDropPin).toBe(true);
    expect(caps.canManagePins).toBe(true);
    expect(caps.canCreateCards).toBe(true);
    expect(caps.canEditContent).toBe(true);
    expect(caps.canOpenInspector).toBe(true);
    expect(caps.canPublishDrag).toBe(true);
    expect(caps.pinsBoardScope).toBe("all");
    expect(caps.boardIdFilter).toBeNull();
    expect(caps.cardIdFilter).toBeNull();
  });

  it("writes nothing when the UI is read-only", () => {
    const caps = capsOf(null, { ...OWNER_UI, readOnly: true });
    expect(caps.role).toBe("owner");
    expect(caps.controllerRole).toBe("viewer");
    expect(caps.bridge).toBe(ICE_VIEW_CAPABILITIES);
    expect(writeFlags(caps)).toEqual([false, false, false, false, false, false, false]);
    expect(caps.canOpenInspector).toBe(true);
  });

  it("drops creation and pins without content, layout or schema rights", () => {
    const noContent = capsOf(null, { ...OWNER_UI, canEditContent: false });
    expect(noContent.canEditContent).toBe(false);
    expect(noContent.canCreateCards).toBe(false);
    expect(noContent.canWriteLayout).toBe(true);
    expect(noContent.canDropPin).toBe(true);

    const noLayout = capsOf(null, { ...OWNER_UI, canEditLayout: false });
    expect(noLayout.role).toBe("owner");
    expect(noLayout.controllerRole).toBe("viewer");
    expect(noLayout.canWriteLayout).toBe(false);
    expect(noLayout.canDropPin).toBe(false);
    expect(noLayout.canPublishDrag).toBe(false);
    expect(noLayout.canCreateCards).toBe(false);
    expect(noLayout.bridge).toBe(ICE_VIEW_CAPABILITIES);

    const noSchema = capsOf(null, { ...OWNER_UI, canManageSchema: false });
    expect(noSchema.canManagePins).toBe(false);
    expect(noSchema.canDropPin).toBe(true);
  });
});

describe("iceShareCaps — workspace share", () => {
  it("an editor follows the UI matrix like an owner, minus ownership", () => {
    const caps = capsOf(share("workspace", "editor"));
    expect(caps.role).toBe("editor");
    expect(caps.controllerRole).toBe("editor");
    expect(caps.bridge).toBe(ICE_EDIT_CAPABILITIES);
    expect(writeFlags(caps).every(Boolean)).toBe(true);
    expect(caps.canOpenInspector).toBe(true);
    expect(caps.pinsBoardScope).toBe("all");
    expect(caps.boardIdFilter).toBeNull();
    expect(caps.cardIdFilter).toBeNull();
  });

  it("a viewer writes nothing even when the UI matrix is permissive", () => {
    const caps = capsOf(share("workspace", "editor", { boardId: "b1" }));
    expect(caps.pinsBoardScope).toBe("all");
    expect(caps.boardIdFilter).toBeNull();

    const viewer = capsOf(share("workspace", "viewer"), PERMISSIVE_UI);
    expect(viewer.role).toBe("viewer");
    expect(viewer.controllerRole).toBe("viewer");
    expect(viewer.bridge).toBe(ICE_VIEW_CAPABILITIES);
    expect(writeFlags(viewer)).toEqual([false, false, false, false, false, false, false]);
    expect(viewer.canOpenInspector).toBe(true);
    expect(viewer.pinsBoardScope).toBe("all");
  });
});

describe("iceShareCaps — board share", () => {
  it("an editor writes layout only through its board filter", () => {
    const caps = capsOf(share("board", "editor", { boardId: "b1" }));
    expect(caps.role).toBe("editor");
    expect(caps.controllerRole).toBe("editor");
    expect(caps.bridge).toBe(ICE_EDIT_CAPABILITIES);
    expect(caps.canWriteLayout).toBe(true);
    expect(caps.canDropPin).toBe(true);
    expect(caps.canManagePins).toBe(true);
    expect(caps.canCreateCards).toBe(true);
    expect(caps.canEditContent).toBe(true);
    expect(caps.canOpenInspector).toBe(true);
    expect(caps.canPublishDrag).toBe(true);
    expect(caps.pinsBoardScope).toBe("scoped");
    expect(caps.boardIdFilter).toBe("b1");
    expect(caps.cardIdFilter).toBeNull();
  });

  it("a viewer writes nothing and still reads its board's pins", () => {
    const caps = capsOf(share("board", "viewer", { boardId: "b1" }), PERMISSIVE_UI);
    expect(caps.role).toBe("viewer");
    expect(caps.bridge).toBe(ICE_VIEW_CAPABILITIES);
    expect(writeFlags(caps)).toEqual([false, false, false, false, false, false, false]);
    expect(caps.canOpenInspector).toBe(true);
    expect(caps.pinsBoardScope).toBe("scoped");
    expect(caps.boardIdFilter).toBe("b1");
  });

  it("a board share that cannot name its board degrades to a viewer with nothing to inspect", () => {
    const missing = capsOf(share("board", "editor", { boardId: null }));
    expect(missing.role).toBe("viewer");
    expect(missing.bridge).toBe(ICE_VIEW_CAPABILITIES);
    expect(writeFlags(missing).every((flag) => !flag)).toBe(true);
    expect(missing.boardIdFilter).toBeNull();
    expect(missing.canOpenInspector).toBe(false);
    expect(missing.pinsBoardScope).toBe("scoped");

    const blank = capsOf(share("board", "editor", { boardId: "  " }));
    expect(blank.role).toBe("viewer");
  });

  it("follows the UI layout gate but keeps content editable", () => {
    const caps = capsOf(share("board", "editor", { boardId: "b1" }), {
      ...OWNER_UI,
      canEditLayout: false,
    });
    expect(caps.role).toBe("editor");
    expect(caps.controllerRole).toBe("viewer");
    expect(caps.canEditContent).toBe(true);
    expect(caps.canWriteLayout).toBe(false);
    expect(caps.canDropPin).toBe(false);
    expect(caps.canPublishDrag).toBe(false);
    expect(caps.bridge).toBe(ICE_VIEW_CAPABILITIES);
  });
});

describe("iceShareCaps — card share", () => {
  it("an editor writes its card's content but never the board", () => {
    const caps = capsOf(share("card", "editor", { cardId: "c1" }));
    expect(caps.role).toBe("editor");
    // The card's content is editable, but the canvas around it is not.
    expect(caps.controllerRole).toBe("viewer");
    expect(caps.bridge).toBe(ICE_VIEW_CAPABILITIES);
    expect(caps.canWriteLayout).toBe(false);
    expect(caps.canDropPin).toBe(false);
    expect(caps.canManagePins).toBe(false);
    expect(caps.canCreateCards).toBe(false);
    expect(caps.canEditContent).toBe(true);
    expect(caps.canPublishDrag).toBe(false);
    expect(caps.canOpenInspector).toBe(true);
    expect(caps.pinsBoardScope).toBe("scoped");
    expect(caps.boardIdFilter).toBeNull();
    expect(caps.cardIdFilter).toBe("c1");
  });

  it("a viewer reads its card only", () => {
    const caps = capsOf(share("card", "viewer", { cardId: "c1" }), PERMISSIVE_UI);
    expect(caps.role).toBe("viewer");
    expect(caps.bridge).toBe(ICE_VIEW_CAPABILITIES);
    expect(caps.canEditContent).toBe(false);
    expect(writeFlags(caps)).toEqual([false, false, false, false, false, false, false]);
    expect(caps.canOpenInspector).toBe(true);
    expect(caps.cardIdFilter).toBe("c1");
  });

  it("a card share that cannot name its card degrades to a viewer", () => {
    const caps = capsOf(share("card", "editor", { cardId: null }));
    expect(caps.role).toBe("viewer");
    expect(caps.canEditContent).toBe(false);
    expect(caps.canOpenInspector).toBe(false);
    expect(caps.cardIdFilter).toBeNull();
  });
});

describe("iceShareCaps — selection share", () => {
  it("is a viewer whatever its role field says", () => {
    const caps = capsOf(share("selection", "editor", { boardId: "b1" }), PERMISSIVE_UI);
    expect(caps.role).toBe("viewer");
    expect(caps.bridge).toBe(ICE_VIEW_CAPABILITIES);
    expect(writeFlags(caps)).toEqual([false, false, false, false, false, false, false]);
    expect(caps.canOpenInspector).toBe(true);
    expect(caps.pinsBoardScope).toBe("scoped");
    expect(caps.boardIdFilter).toBe("b1");
    expect(caps.cardIdFilter).toBeNull();
  });
});

describe("withinShareScope", () => {
  it("accepts any named target for an owner", () => {
    expect(withinShareScope({ boardId: "b1" }, null)).toBe(true);
    expect(withinShareScope({ cardId: "c1" }, null)).toBe(true);
    expect(withinShareScope({ boardId: "b1", cardId: "c1" }, null)).toBe(true);
  });

  it("treats an unknown target as outside every scope", () => {
    expect(withinShareScope({}, null)).toBe(false);
    expect(withinShareScope({ boardId: null, cardId: null }, null)).toBe(false);
    expect(withinShareScope({ boardId: "" }, null)).toBe(false);
    expect(withinShareScope({ cardId: "   " }, share("workspace", "editor"))).toBe(false);
    expect(withinShareScope({}, share("card", "editor", { cardId: "c1" }))).toBe(false);
    expect(withinShareScope({}, share("board", "editor", { boardId: "b1" }))).toBe(false);
  });

  it("accepts every named target for a workspace share", () => {
    const workspace = share("workspace", "editor");
    expect(withinShareScope({ boardId: "b9" }, workspace)).toBe(true);
    expect(withinShareScope({ cardId: "c9" }, workspace)).toBe(true);
    expect(withinShareScope({ boardId: "b9", cardId: "c9" }, workspace)).toBe(true);
  });

  it("confines a board share to its board", () => {
    const board = share("board", "editor", { boardId: "b1" });
    expect(withinShareScope({ boardId: "b1" }, board)).toBe(true);
    expect(withinShareScope({ boardId: "b2" }, board)).toBe(false);
    expect(withinShareScope({ boardId: "b2", cardId: "c9" }, board)).toBe(false);
    // A card-only target is read from the board projection itself.
    expect(withinShareScope({ cardId: "c9" }, board)).toBe(true);
    expect(withinShareScope({ boardId: "b1", cardId: "c9" }, board)).toBe(true);
    expect(withinShareScope({ boardId: "b1" }, share("board", "editor", { boardId: null }))).toBe(
      false,
    );
  });

  it("confines a card share to its one card", () => {
    const card = share("card", "editor", { cardId: "c1" });
    expect(withinShareScope({ cardId: "c1" }, card)).toBe(true);
    expect(withinShareScope({ cardId: "c2" }, card)).toBe(false);
    // A board target is outside a card share: it owns no placement.
    expect(withinShareScope({ boardId: "b1" }, card)).toBe(false);
    // A card share that names no board cannot contradict a board-qualified
    // target; the card id is the authority.
    expect(withinShareScope({ cardId: "c1", boardId: "b2" }, card)).toBe(true);
    const bound = share("card", "editor", { cardId: "c1", boardId: "b1" });
    expect(withinShareScope({ cardId: "c1", boardId: "b1" }, bound)).toBe(true);
    expect(withinShareScope({ cardId: "c1", boardId: "b2" }, bound)).toBe(false);
    expect(withinShareScope({ cardId: "c1" }, share("card", "editor", { cardId: null }))).toBe(
      false,
    );
  });

  it("refuses every target for a viewer or a selection share", () => {
    expect(withinShareScope({ boardId: "b1" }, share("board", "viewer", { boardId: "b1" }))).toBe(
      false,
    );
    expect(withinShareScope({ cardId: "c1" }, share("card", "viewer", { cardId: "c1" }))).toBe(
      false,
    );
    expect(withinShareScope({ boardId: "b1" }, share("workspace", "viewer"))).toBe(false);
    expect(
      withinShareScope({ boardId: "b1" }, share("selection", "editor", { boardId: "b1" })),
    ).toBe(false);
    expect(
      withinShareScope({ cardId: "c1" }, share("selection", "viewer", { boardId: "b1" })),
    ).toBe(false);
  });
});

describe("visiblePinFilter", () => {
  const pins = [
    { id: "p1", boardId: "b1" },
    { id: "p2", boardId: "b2" },
    { id: "p3", boardId: "b1" },
  ];

  it("keeps every pin for an owner or a workspace share", () => {
    expect(visiblePinFilter(pins, null)).toEqual(pins);
    expect(visiblePinFilter(pins, share("workspace", "editor"))).toEqual(pins);
    expect(visiblePinFilter(pins, share("workspace", "viewer"))).toEqual(pins);
    expect(visiblePinFilter(pins, null)).not.toBe(pins);
  });

  it("keeps one board's pins for a board share, in order", () => {
    const board = share("board", "editor", { boardId: "b1" });
    expect(visiblePinFilter(pins, board)).toEqual([pins[0], pins[2]]);
    expect(visiblePinFilter(pins, share("board", "viewer", { boardId: "b1" }))).toEqual([
      pins[0],
      pins[2],
    ]);
    expect(visiblePinFilter(pins, share("board", "editor", { boardId: "b2" }))).toEqual([pins[1]]);
    expect(visiblePinFilter(pins, share("board", "editor", { boardId: "b3" }))).toEqual([]);
  });

  it("keeps one board's pins for a selection share", () => {
    expect(visiblePinFilter(pins, share("selection", "viewer", { boardId: "b2" }))).toEqual([
      pins[1],
    ]);
  });

  it("lists no pins for a card share, whatever it names", () => {
    expect(visiblePinFilter(pins, share("card", "editor", { cardId: "c1" }))).toEqual([]);
    expect(
      visiblePinFilter(pins, share("card", "viewer", { cardId: "c1", boardId: "b1" })),
    ).toEqual([]);
  });

  it("lists no pins for a board share that cannot name its board", () => {
    expect(visiblePinFilter(pins, share("board", "editor", { boardId: null }))).toEqual([]);
    expect(visiblePinFilter(pins, share("board", "editor", { boardId: "  " }))).toEqual([]);
  });
});
