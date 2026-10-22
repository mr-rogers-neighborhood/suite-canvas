import { afterEach, describe, expect, it } from "vitest";
import { workspaceUrl } from "./workspaceTransfer";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("workspaceUrl", () => {
  it("builds a plain editor URL without an owner key", () => {
    const url = new URL(workspaceUrl("ws-1", "board-1"));
    expect(url.searchParams.get("workspace")).toBe("ws-1");
    expect(url.searchParams.get("board")).toBe("board-1");
    expect(url.hash).toBe("");
  });

  it("adds the owner key as a fragment", () => {
    const url = new URL(workspaceUrl("ws-1", "board-1", "owner-key"));
    expect(url.searchParams.get("workspace")).toBe("ws-1");
    expect(url.searchParams.get("board")).toBe("board-1");
    expect(url.hash).toBe("#owner=owner-key");
  });

  it("does not inherit the current page's owner fragment", () => {
    window.history.replaceState({}, "", "/?workspace=old#owner=old-key");

    const plain = new URL(workspaceUrl("ws-2"));
    expect(plain.hash).toBe("");

    const owned = new URL(workspaceUrl("ws-2", null, "new-key"));
    expect(owned.hash).toBe("#owner=new-key");
  });
});
