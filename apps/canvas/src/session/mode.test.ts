import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceActions } from "../chrome/WorkspaceActions";
import { useUiStore } from "../store/useUiStore";
import { bootPlan, DEFAULT_SUITE_MODE, hasShareLink, isStandalone, suiteMode } from "./mode";
import { configureSession, standaloneSession } from "./session";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("suiteMode", () => {
  it("is local, whatever the build asked for", () => {
    expect(suiteMode()).toBe(DEFAULT_SUITE_MODE);
    expect(suiteMode()).toBe("local");
    expect(isStandalone()).toBe(true);
  });

  it("does not become something else when a stale relay profile is set", () => {
    // A build that still passes `VITE_SUITE_MODE=relay` gets the local profile and
    // a warning: the service it was written for is not in this repository.
    vi.stubEnv("VITE_SUITE_MODE", "relay");
    expect(suiteMode()).toBe("local");
    expect(isStandalone()).toBe(true);
  });
});

describe("bootPlan", () => {
  it("never resolves a share or opens a provider, whatever the URL", () => {
    // A capability link is just a page URL now: the relay that link belonged to is
    // not part of this build, so nothing may be fetched on the way to the launcher.
    for (const url of ["/?share=abc", "/#share-session", "/?workspace=ws-1", "/"]) {
      expect(bootPlan("local", url)).toEqual({
        resolveShare: false,
        connectProvider: false,
        showSharing: false,
      });
    }
  });

  it("still recognises a share-shaped URL", () => {
    // The helper stays because the launcher says "this build is local" instead of
    // pretending a dead link works.
    expect(hasShareLink("/?share=abc")).toBe(true);
    expect(hasShareLink("/?workspace=ws-1")).toBe(false);
  });
});

describe("the workspace menu", () => {
  it("keeps export reachable and offers no share row", () => {
    useUiStore.setState({ canManageLinks: false });
    configureSession(standaloneSession({ workspaceId: "ws-1" }));

    render(createElement(WorkspaceActions, { workspaceId: "ws-1", title: "Local" }));

    fireEvent.click(screen.getByTestId("workspace-menu"));
    expect(screen.queryByTestId("workspace-menu-share")).toBeNull();
    expect(screen.getByTestId("workspace-export-backup")).toBeTruthy();
    expect(screen.getByTestId("workspace-export-json")).toBeTruthy();
    expect(screen.getByTestId("workspace-export-markdown")).toBeTruthy();
    expect(screen.queryByTestId("workspace-recovery-key")).toBeNull();
  });
});

/**
 * Source-level guard rail. Nothing here executes the app: it reads
 * `apps/canvas/src` and fails when a file grows a network call.
 *
 * The app talks to nothing. Before the relay was retired this listed the modules
 * allowed to reach it and the files that gated them off; now the list is down to
 * one, and anything new fails here rather than shipping a request to a service
 * that does not exist.
 */
describe("no network calls", () => {
  const SRC =
    ["apps/canvas/src", "src"]
      .map((candidate) => path.resolve(process.cwd(), candidate))
      .find((candidate) => existsSync(path.join(candidate, "main.tsx"))) ??
    path.resolve(process.cwd(), "src");

  /**
   * Files that still contain a request, each with the branch that stops it.
   *
   * Every one asks a relay for bytes it cannot get locally: a cover image, a
   * sketch, a book, its metadata. The branch is `isStandalone()`, which is
   * constant true, so none of them runs. They are listed rather than deleted in
   * this commit because each is a local-first fallback to write, not a line to
   * remove — deleting the request would delete the feature that reads it.
   */
  const ALLOWED: Readonly<Record<string, RegExp>> = {
    // It asks this origin for the page it was served from, to notice a stale build.
    "app/useStaleBuild.ts": /fetch\("\/"/u,
    // A cover link is fetched by the panel; the bytes only reach a relay through
    // `relayUploader`, which now returns null everywhere.
    "styles/coverFromUrl.ts": /relayUploader\(\)/u,
    "cards/sketchFiles.ts": /isStandalone\(\)/u,
    "reader/useBookBytes.ts": /isStandalone\(\)/u,
    "reader/bookMeta.ts": /isStandalone\(\)/u,
  };

  const NETWORK_CALL = /\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b|\bEventSource\s*\(/u;

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(full);
      if (!/\.(?:ts|tsx)$/u.test(entry.name)) return [];
      if (/\.(?:test|stories)\.(?:ts|tsx)$/u.test(entry.name)) return [];
      return [full];
    });
  }

  it("appears only where a file is allowed to have one", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const text = readFileSync(file, "utf8");
      if (!NETWORK_CALL.test(text)) continue;
      const allowed = ALLOWED[rel];
      if (allowed === undefined || !allowed.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
