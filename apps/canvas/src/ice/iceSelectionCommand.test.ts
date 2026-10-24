import { afterEach, describe, expect, it, vi } from "vitest";

import { selectCardsInIce, setIceSelectionCommand } from "./iceSelectionCommand";

afterEach(() => {
  setIceSelectionCommand(null);
});

describe("iceSelectionCommand", () => {
  it("does nothing when no surface is attached", () => {
    expect(selectCardsInIce(["card-1"])).toBe(false);
  });

  it("hands the ids to the surface's own selection path", () => {
    const command = vi.fn();
    setIceSelectionCommand(command);

    expect(selectCardsInIce(["card-1", "card-2"])).toBe(true);
    expect(command).toHaveBeenCalledWith(["card-1", "card-2"]);
  });

  it("forgets the writer when the surface unmounts", () => {
    const command = vi.fn();
    setIceSelectionCommand(command);
    setIceSelectionCommand(null);

    expect(selectCardsInIce(["card-1"])).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });
});
