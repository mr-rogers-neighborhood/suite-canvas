import { afterEach, describe, expect, it } from "vitest";
import { forgetLastBoard, readLastBoard, rememberLastBoard } from "./lastBoard";

const KEY = "suite.lastBoard.v1";

describe("last board", () => {
  afterEach(() => localStorage.removeItem(KEY));

  it("should answer with nothing for a workspace it has never seen", () => {
    expect(readLastBoard("ws-1")).toBeNull();
  });

  it("should remember one board per workspace", () => {
    rememberLastBoard("ws-1", "b1");
    rememberLastBoard("ws-2", "b9");
    expect(readLastBoard("ws-1")).toBe("b1");
    expect(readLastBoard("ws-2")).toBe("b9");
  });

  it("should replace the board rather than accumulate", () => {
    rememberLastBoard("ws-1", "b1");
    rememberLastBoard("ws-1", "b2");
    expect(readLastBoard("ws-1")).toBe("b2");
  });

  it("should forget a workspace that was deleted", () => {
    rememberLastBoard("ws-1", "b1");
    forgetLastBoard("ws-1");
    expect(readLastBoard("ws-1")).toBeNull();
  });

  it("should survive a value that is not a map", () => {
    localStorage.setItem(KEY, "[]");
    expect(readLastBoard("ws-1")).toBeNull();
  });
});
