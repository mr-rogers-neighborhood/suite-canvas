import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { isPortalCard, PORTAL_GLYPH, portalTargetId } from "./portal";

describe("portal helpers", () => {
  it("should identify a card by its primary type", () => {
    expect(isPortalCard({ primaryTypeId: PORTAL_TYPE_ID })).toBe(true);
    expect(isPortalCard({ primaryTypeId: "note" })).toBe(false);
    expect(isPortalCard(null)).toBe(false);
  });

  it("should read the target board id from the board field", () => {
    expect(
      portalTargetId({
        primaryTypeId: PORTAL_TYPE_ID,
        properties: { [PORTAL_BOARD_FIELD_ID]: "board-b" },
      }),
    ).toBe("board-b");
  });

  it("should treat a missing or non-text target as no target", () => {
    expect(portalTargetId({ primaryTypeId: PORTAL_TYPE_ID, properties: {} })).toBeNull();
    expect(
      portalTargetId({ primaryTypeId: PORTAL_TYPE_ID, properties: { [PORTAL_BOARD_FIELD_ID]: 3 } }),
    ).toBeNull();
    expect(
      portalTargetId({
        primaryTypeId: PORTAL_TYPE_ID,
        properties: { [PORTAL_BOARD_FIELD_ID]: "  " },
      }),
    ).toBeNull();
  });

  it("should ignore a board value on a card that is not a portal", () => {
    expect(
      portalTargetId({ primaryTypeId: "note", properties: { [PORTAL_BOARD_FIELD_ID]: "board-b" } }),
    ).toBeNull();
  });

  it("should keep the seeded glyph", () => {
    expect(PORTAL_GLYPH).toBe("\u25c9");
  });
});
