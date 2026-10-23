import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDiagnostics, safeRoute, useDiagnosticsStore } from "./diagnostics";
import { CanvasErrorBoundary } from "./ErrorBoundary";

const OWNER_KEY = "owner-key-0964a30f-2d21-4a5e-9a6e-4b1a6d0d3c11";

function Broken(): never {
  throw new Error("the board exploded");
}

describe("error boundary", () => {
  afterEach(() => {
    useDiagnosticsStore.getState().clear();
    vi.restoreAllMocks();
  });

  it("renders a diagnostic page instead of a blank one", () => {
    // React logs the caught error; keep the test output readable.
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <CanvasErrorBoundary>
        <Broken />
      </CanvasErrorBoundary>,
    );

    expect(screen.getByTestId("crash-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("crash-build")).toHaveTextContent(/dev|production|test/);
    expect(screen.getByTestId("crash-route")).toHaveTextContent("/");
    expect((screen.getByTestId("diagnostic-block") as HTMLTextAreaElement).value).toContain(
      "the board exploded",
    );
    expect(screen.getByTestId("reload-app")).toBeInTheDocument();
    expect(screen.getByTestId("export-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("copy-diagnostics")).toBeInTheDocument();
    // The boundary remembered the error for the storage panel's bundle.
    expect(useDiagnosticsStore.getState().lastError?.message).toBe("the board exploded");
  });

  it("renders children when nothing throws", () => {
    render(
      <CanvasErrorBoundary>
        <p>fine</p>
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
    expect(screen.queryByTestId("crash-fallback")).not.toBeInTheDocument();
  });
});

describe("diagnostics bundle", () => {
  it("strips the owner fragment and redacts a share token from the route", () => {
    const route = safeRoute(`https://suite.test/?workspace=ws-1&share=sekret#owner=${OWNER_KEY}`);
    expect(route).toBe("/?workspace=ws-1&share=redacted");
    expect(route).not.toContain(OWNER_KEY);
  });

  it("carries build, route, storage and the last error and nothing else", () => {
    const text = buildDiagnostics({
      route: `https://suite.test/?workspace=ws-1#owner=${OWNER_KEY}`,
      build: { version: "0.2.0-alpha.1", mode: "production", production: true },
      storage: { persist: "denied", estimate: { usage: 2048, quota: 4096 }, quota: null },
      connection: "live",
      lastError: {
        name: "Error",
        message: "boom",
        stack: "Error: boom\n  at render (app.js:1:1)",
        at: 0,
        route: "/",
      },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(text).toContain("build: 0.2.0-alpha.1 (production)");
    expect(text).toContain("route: /?workspace=ws-1");
    expect(text).toContain("storage: persist=denied usage=2 KB of 4 KB");
    expect(text).toContain("connection: live");
    expect(text).toContain("last error: Error: boom");
    expect(text).not.toContain(OWNER_KEY);
  });

  it("says so plainly when nothing has failed yet", () => {
    const text = buildDiagnostics({
      route: "/",
      storage: { persist: "persisted", estimate: { usage: null, quota: null }, quota: null },
      connection: "offline",
      lastError: null,
    });
    expect(text).toContain("last error: none recorded");
    expect(text).toContain("usage=unknown");
  });
});
