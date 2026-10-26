import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureSession } from "../session/session";
import {
  ANONYMOUS_FLAG,
  forgetAnonymousSession,
  hadAnonymousSession,
  linkPrompt,
  localWorkspaceIds,
  rememberAnonymousSession,
} from "./anonymous";

beforeEach(() => {
  window.localStorage.clear();
  configureSession({
    workspaceId: null,
    roomId: null,
    share: null,
    role: "editor",
    readOnly: false,
    credential: "account",
  });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the anonymous flag", () => {
  it("remembers that this browser once worked without an account", () => {
    expect(hadAnonymousSession()).toBe(false);
    rememberAnonymousSession();
    expect(window.localStorage.getItem(ANONYMOUS_FLAG)).toBe("1");
    expect(hadAnonymousSession()).toBe(true);
    forgetAnonymousSession();
    expect(hadAnonymousSession()).toBe(false);
  });

  it("is idempotent and survives storage that refuses writes", () => {
    const setItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(() => rememberAnonymousSession()).not.toThrow();
      expect(() => forgetAnonymousSession()).not.toThrow();
    } finally {
      window.localStorage.setItem = setItem;
    }
  });
});

describe("the local workspaces a link would carry", () => {
  it("is the recents list plus the open workspace, without duplicates", () => {
    window.localStorage.setItem(
      "suite.recentWorkspaces.v1",
      JSON.stringify([
        { id: "ws-1", title: "One", lastOpenedAt: 2 },
        { id: "ws-2", title: "Two", lastOpenedAt: 1 },
      ]),
    );
    configureSession({
      workspaceId: "ws-2",
      roomId: "ws-2",
      share: null,
      role: "editor",
      readOnly: false,
      credential: "account",
    });

    expect(localWorkspaceIds()).toEqual(["ws-2", "ws-1"]);
  });
});

describe("the one prompt", () => {
  it("says how many workspaces moved, and that the links did not", () => {
    const prompt = linkPrompt({
      email: "reader@example.com",
      workspaceIds: ["ws-1", "ws-2"],
      wasAnonymous: true,
    });
    expect(prompt?.count).toBe(2);
    expect(prompt?.message).toContain("2 local workspaces");
    expect(prompt?.message).toContain("reader@example.com");
    expect(prompt?.message).toContain("links did not change");
  });

  it("speaks in the singular for one workspace", () => {
    const prompt = linkPrompt({
      email: null,
      workspaceIds: ["ws-1"],
      wasAnonymous: true,
    });
    expect(prompt?.message).toContain("1 local workspace now belongs to your account");
  });

  it("says nothing at all when there is nothing to say", () => {
    expect(linkPrompt({ email: "a@b.c", workspaceIds: ["ws-1"], wasAnonymous: false })).toBeNull();
    expect(linkPrompt({ email: "a@b.c", workspaceIds: [], wasAnonymous: true })).toBeNull();
    expect(linkPrompt({ email: "a@b.c", workspaceIds: ["   "], wasAnonymous: true })).toBeNull();
  });
});
