import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceActions } from "../components/WorkspaceActions";
import { useUiStore } from "../store/useUiStore";
import {
  bootPlan,
  DEFAULT_SUITE_MODE,
  hasShareLink,
  isStandalone,
  suiteMode,
  workspaceIdFromUrl,
} from "./mode";
import {
  configureSession,
  getSession,
  sessionCapabilities,
  sessionForShare,
  standaloneSession,
} from "./session";
import { SHARE_SESSION_FRAGMENT, type Share } from "./shares";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("suiteMode", () => {
  it("defaults to relay so a plain checkout keeps the full product", () => {
    expect(suiteMode()).toBe(DEFAULT_SUITE_MODE);
    expect(suiteMode()).toBe("relay");
    expect(isStandalone()).toBe(false);
  });

  it("only the exact standalone value switches the build profile", () => {
    vi.stubEnv("VITE_SUITE_MODE", "standalone");
    expect(isStandalone()).toBe(true);

    vi.stubEnv("VITE_SUITE_MODE", "Standalone");
    expect(isStandalone()).toBe(false);

    vi.stubEnv("VITE_SUITE_MODE", "relay");
    expect(isStandalone()).toBe(false);
  });
});

describe("bootPlan", () => {
  it("never resolves a share or claims in a standalone build, whatever the URL", () => {
    // A capability link opened in a local-only build: no fetch may be attempted
    // and no owner key may be claimed, because neither relay exists here.
    for (const url of [
      "/?share=abc",
      "/?share=abc&workspace=ws-1",
      "/#share-session",
      "/?workspace=ws-1",
      "/",
    ]) {
      expect(bootPlan("standalone", url)).toEqual({
        resolveShare: false,
        claimOwner: false,
        connectProvider: false,
        showSharing: false,
      });
    }
  });

  it("still resolves a share link and claims a workspace on a relay", () => {
    expect(bootPlan("relay", "/?share=abc")).toEqual({
      resolveShare: true,
      // A share link is not this browser's workspace to claim.
      claimOwner: false,
      connectProvider: true,
      showSharing: true,
    });

    expect(bootPlan("relay", "/?workspace=ws-1")).toEqual({
      resolveShare: false,
      claimOwner: true,
      connectProvider: true,
      showSharing: true,
    });

    // The launcher: nothing to claim and no share, but the provider still runs.
    expect(bootPlan("relay", "/")).toEqual({
      resolveShare: false,
      claimOwner: false,
      connectProvider: true,
      showSharing: true,
    });
  });

  it("reads share links, the resume marker and workspace ids from a page URL", () => {
    expect(hasShareLink("/?share=abc")).toBe(true);
    expect(hasShareLink(`/${SHARE_SESSION_FRAGMENT}`)).toBe(true);
    expect(hasShareLink("/?workspace=ws-1")).toBe(false);
    // `mode.ts` copies this marker so it stays free of the share client: this
    // assertion is the link between the copy and `shares.ts`.
    expect(SHARE_SESSION_FRAGMENT).toBe("#share-session");
    expect(workspaceIdFromUrl("/?workspace=ws-1")).toBe("ws-1");
    expect(workspaceIdFromUrl("/?doc=legacy")).toBe("legacy");
    expect(workspaceIdFromUrl("/?workspace=")).toBeNull();
    expect(workspaceIdFromUrl("not a url with spaces")).toBeNull();
  });
});

describe("standalone session", () => {
  const share: Share = {
    id: "share-1",
    scope: "workspace",
    role: "editor",
    workspaceId: "workspace-1",
    boardId: null,
    cardId: null,
    createdAt: 0,
    revokedAt: null,
    expiresAt: null,
    roomId: "workspace-1",
    cardIds: [],
    cardCount: 0,
  };

  it("hides link management and publishing but keeps local editing", () => {
    vi.stubEnv("VITE_SUITE_MODE", "standalone");
    const capabilities = sessionCapabilities(getSession());
    expect(capabilities.canManageLinks).toBe(false);
    expect(capabilities.canPublish).toBe(false);
    expect(capabilities.canEditContent).toBe(true);
    expect(capabilities.canEditLayout).toBe(true);
    expect(capabilities.canCreateContent).toBe(true);
    expect(capabilities.canCreateBoards).toBe(true);
    expect(capabilities.canManageBoards).toBe(true);
    expect(capabilities.canManageSchema).toBe(true);
    expect(capabilities.canManageTrash).toBe(true);
  });

  it("cannot regain link management through a share-shaped session", () => {
    vi.stubEnv("VITE_SUITE_MODE", "standalone");
    // A relay-style owner session would carry links; the build profile wins.
    const owner = sessionCapabilities(getSession());
    expect(owner.canManageLinks).toBe(false);
    const projected = sessionCapabilities(sessionForShare("tok", share));
    expect(projected.canManageLinks).toBe(false);
    expect(projected.canPublish).toBe(false);
  });

  it("boots a workspace with no owner key and no share", () => {
    vi.stubEnv("VITE_SUITE_MODE", "standalone");
    configureSession(
      standaloneSession({
        workspaceId: "ws-1",
        roomId: "ws-1",
        share: sessionForShare("tok", share).share,
        role: "editor",
        readOnly: false,
        ownerKey: "owner-key",
      }),
    );
    expect(getSession()).toMatchObject({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      ownerKey: null,
    });
  });
});

describe("standalone workspace actions", () => {
  it("keeps export reachable while Share and the recovery key are gone", () => {
    vi.stubEnv("VITE_SUITE_MODE", "standalone");
    // What `useUiStore` derives from STANDALONE_CAPABILITIES at boot.
    useUiStore.setState({ canManageLinks: false });
    configureSession(
      standaloneSession({
        workspaceId: "ws-1",
        roomId: "ws-1",
        share: null,
        role: "editor",
        readOnly: false,
        ownerKey: null,
      }),
    );

    render(createElement(WorkspaceActions, { workspaceId: "ws-1", boardId: null, title: "Local" }));

    // No link management, so no Share button and no key to manage.
    expect(screen.queryByTestId("workspace-share")).toBeNull();

    // Export is local, so the File menu survives for the standalone profile.
    fireEvent.click(screen.getByTestId("workspace-file"));
    expect(screen.getByTestId("workspace-export-backup")).toBeTruthy();
    expect(screen.getByTestId("workspace-export-json")).toBeTruthy();
    expect(screen.getByTestId("workspace-export-markdown")).toBeTruthy();
    expect(screen.queryByTestId("workspace-recovery-key")).toBeNull();
  });
});

/**
 * Source-level guard rails. Nothing here executes the app: these tests read
 * `apps/canvas/src` and fail when a change would let a standalone build reach a
 * relay it does not have.
 */
describe("standalone guard rails", () => {
  // jsdom gives `import.meta.url` a http origin, so the tree is found from the
  // working directory: the repo root when vitest runs from there, else the
  // package.
  const SRC =
    ["apps/canvas/src", "src"]
      .map((candidate) => path.resolve(process.cwd(), candidate))
      .find((candidate) => existsSync(path.join(candidate, "main.tsx"))) ??
    path.resolve(process.cwd(), "src");

  /** Calls that can only ever reach a relay. */
  const RELAY_CALL = /\bfetch\s*\(|\bWebSocket\s*\(|collabHttpBase\s*\(\s*\)/u;

  /**
   * Modules allowed to contain a relay call, each with the files that gate them
   * off in a standalone build. Anything else that talks to a relay fails the
   * test below instead of shipping a request to a URL that is not there.
   */
  const RELAY_MODULES: Readonly<Record<string, readonly string[]>> = {
    "session/ownerKey.ts": ["main.tsx"],
    "session/shares.ts": ["main.tsx", "App.tsx", "components/WorkspaceActions.tsx"],
    // The operator panel is its own `admin.html` entry; the app never imports it.
    "admin/api.ts": [],
  };

  /**
   * Modules that legitimately serve both profiles: they take the profile as an
   * argument and only reach the relay inside that branch. The guard cannot
   * prove a runtime branch, so instead it requires the branch to be spelled
   * out here — deleting the check fails the test.
   */
  const PROFILE_BRANCHED_MODULES: Readonly<Record<string, RegExp>> = {
    "session/workspaceDelete.ts": /input\.profile === "relay"/u,
  };

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "test" ? [] : sourceFiles(full);
      }
      if (!/\.(?:ts|tsx)$/u.test(entry.name)) return [];
      if (/\.(?:test|stories)\.(?:ts|tsx)$/u.test(entry.name)) return [];
      return [full];
    });
  }

  const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

  it("keeps every direct relay call in a module standalone never loads", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => RELAY_CALL.test(readFileSync(file, "utf8")))
      .map(relative)
      .filter((file) => !(file in RELAY_MODULES))
      .filter((file) => {
        const branch = PROFILE_BRANCHED_MODULES[file];
        if (!branch) return true;
        const source = readFileSync(path.join(SRC, file), "utf8");
        expect(source, `${file} must gate its relay call on the profile`).toMatch(branch);
        return false;
      });
    expect(
      offenders,
      "These modules call a relay directly. Put the call behind isStandalone() " +
        "or add the module to RELAY_MODULES with the gate that keeps standalone away from it.",
    ).toEqual([]);
  });

  it("still has the standalone gate that each relay module depends on", () => {
    for (const [relayModule, gates] of Object.entries(RELAY_MODULES)) {
      expect(existsSync(path.join(SRC, relayModule)), `${relayModule} moved`).toBe(true);
      for (const gate of gates) {
        const source = readFileSync(path.join(SRC, gate), "utf8");
        // Either the helper or the literal the bundler can fold: both mean a
        // standalone build never runs this file.
        expect(source, `${gate} must gate ${relayModule} on the build profile`).toMatch(
          /isStandalone\(\)|VITE_SUITE_MODE/u,
        );
      }
    }
  });

  it("keeps the sync transport out of a standalone bundle", () => {
    // `useCanvasStore` builds its Loro provider at module load and that provider
    // opens its socket in the constructor, so a standalone build must take the
    // store's "no transport" path. That decision lives in the store itself —
    // checked here by reading the source, because a runtime test would need a
    // window and a socket to prove a negative.
    const store = readFileSync(path.join(SRC, "store/useCanvasStore.ts"), "utf8");
    expect(store).toMatch(/isStandalone\(\)/u);
    expect(store).toMatch(/NO_TRANSPORT/u);
    // No build-time rewriting of `import.meta.env.MODE`: the profile is read
    // once, in `mode.ts`, and nothing else needs to impersonate a test build.
    const config = readFileSync(path.resolve(SRC, "..", "vite.config.ts"), "utf8");
    expect(config).not.toMatch(/"import\.meta\.env\.MODE"/u);
  });

  it("keeps the relay client out of the boot chunk", () => {
    const main = readFileSync(path.join(SRC, "main.tsx"), "utf8");
    // `main.tsx` must load the share client and the owner-key claim on demand:
    // a static import would put them in every build's boot chunk, standalone
    // included, no matter what the runtime check does.
    expect(main).not.toMatch(/from\s+"\.\/session\/(?:ownerKey|shares)"/u);
    expect(main).toMatch(/import\("\.\/session\/shares"\)/u);
    // The literal, not a helper call, is what lets the bundler drop the branch.
    expect(main).toMatch(/VITE_SUITE_MODE !== "standalone"/u);
  });
});
