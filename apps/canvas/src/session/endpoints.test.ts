import { afterEach, describe, expect, it, vi } from "vitest";
import { collabHttpBase, collabWsUrl } from "./endpoints";

const PAGE = {
  origin: "https://suite.example.com",
  protocol: "https:",
  host: "suite.example.com",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("collabHttpBase", () => {
  it("uses the dev server by default", () => {
    expect(collabHttpBase(PAGE)).toBe("http://localhost:1235");
  });

  it("prefers a configured URL and trims trailing slashes", () => {
    vi.stubEnv("VITE_COLLAB_HTTP_URL", "https://api.example.com/");
    expect(collabHttpBase(PAGE)).toBe("https://api.example.com");
  });

  it("falls back to the page origin in a production build", () => {
    vi.stubEnv("DEV", false);
    expect(collabHttpBase(PAGE)).toBe("https://suite.example.com");
  });

  it("ignores a blank configured URL", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_COLLAB_HTTP_URL", "  ");
    expect(collabHttpBase(PAGE)).toBe("https://suite.example.com");
  });
});

describe("collabWsUrl", () => {
  it("uses the dev socket by default", () => {
    expect(collabWsUrl(PAGE)).toBe("ws://localhost:1234");
  });

  it("prefers a configured URL", () => {
    vi.stubEnv("VITE_COLLAB_URL", "wss://collab.example.com");
    expect(collabWsUrl(PAGE)).toBe("wss://collab.example.com");
  });

  it("uses a secure same-origin socket in production", () => {
    vi.stubEnv("DEV", false);
    expect(collabWsUrl(PAGE)).toBe("wss://suite.example.com/ws");
  });

  it("keeps ws on a plain-http page", () => {
    vi.stubEnv("DEV", false);
    expect(collabWsUrl({ origin: "http://localhost", protocol: "http:", host: "localhost" })).toBe(
      "ws://localhost/ws",
    );
  });
});
