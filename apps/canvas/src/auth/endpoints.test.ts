import { afterEach, describe, expect, it, vi } from "vitest";
import { authClientBase, authServiceBase, claimWorkspaceUrl } from "./endpoints";

const PAGE = { origin: "https://suite.example.com" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth service base", () => {
  it("is the page's own origin when nothing is configured", () => {
    // Same-origin by default: a hosted build serves /api from the page, so CORS
    // never enters the picture and there is no host to guess.
    expect(authServiceBase(PAGE)).toBe("https://suite.example.com");
    expect(authClientBase(PAGE)).toBe("https://suite.example.com/api/auth");
    expect(claimWorkspaceUrl(PAGE)).toBe("https://suite.example.com/api/workspaces/claim");
  });

  it("follows a self-hosted control plane, trimming trailing slashes", () => {
    vi.stubEnv("VITE_SUITE_AUTH_URL", "https://accounts.example/");
    expect(authClientBase(PAGE)).toBe("https://accounts.example/api/auth");
    expect(claimWorkspaceUrl(PAGE)).toBe("https://accounts.example/api/workspaces/claim");
  });

  it("ignores a blank configured URL rather than producing a hostless one", () => {
    vi.stubEnv("VITE_SUITE_AUTH_URL", "   ");
    expect(authClientBase(PAGE)).toBe("https://suite.example.com/api/auth");
  });
});
