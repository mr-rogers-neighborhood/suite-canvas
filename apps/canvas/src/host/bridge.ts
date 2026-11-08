/**
 * Which process is hosting this renderer.
 *
 * The renderer is one bundle on the web and on the desktop. What differs is what
 * it can reach: a browser has IndexedDB and `fetch`, a desktop build has a main
 * process with the file, the menu and the operating system. The host signal is
 * the bridge the preload injects, not a build flag — a flag would say what was
 * compiled, while the renderer needs to know what actually loaded beside it.
 *
 * The bridge is deliberately small. Every method added here is a new thing the
 * renderer may ask the main process to do, so each one is added in the increment
 * that needs it and allowlisted in the preload. Note what none of them take: a
 * path. The renderer says *what* to do, and the main process decides *where*.
 */

/** Global the preload sets. One name, so there is one thing to look for. */
export const DESKTOP_BRIDGE_KEY = "suiteDesktop";

/** One attachment's bytes, as the main process needs them to write the file. */
export interface BridgeAttachment {
  readonly id: string;
  readonly mime: string;
  readonly name: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly bytes: Uint8Array;
}

/** What the main process says the open document is. */
export interface BridgeDocumentInfo {
  readonly workspaceId: string;
  readonly path: string;
  readonly name: string;
  /** The legacy file this open converted, when it was one. */
  readonly migratedFrom: string | null;
  /** The backup this open recovered from, when the file was damaged. */
  readonly recoveredFrom: string | null;
}

/**
 * What creating a document did.
 *
 * A reason, because a button that does nothing is the one outcome a person cannot act on.
 */
export type BridgeCreateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Everything the first write of a new document needs. No path: main decides where. */
export interface BridgeCreateRequest {
  readonly workspaceId: string;
  /** The workspace's own name, used to name the file. */
  readonly title: string;
  readonly snapshot: Uint8Array;
  readonly manifest: BridgeSaveRequest["manifest"];
}

export interface BridgeSaveRequest {
  readonly workspaceId: string;
  /** The workspace's own name, used to name the file on its first save. */
  readonly title?: string;
  readonly snapshot: Uint8Array;
  readonly manifest: {
    readonly boards: number;
    readonly cards: number;
    readonly types: number;
    readonly tags: number;
  };
  /** Present only when the attachment set changed. */
  readonly attachments?: readonly BridgeAttachment[];
}

/** One entry in the launcher's recent list, as the shell reports it. */
export interface BridgeRecentFile {
  readonly path: string;
  readonly name: string;
  readonly folder: string;
  readonly openedAt: number;
}

/** A refusal the renderer must show rather than swallow. */
export interface BridgeFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

/** What a desktop build's preload exposes. A present bridge *is* the desktop. */
export interface DesktopBridge {
  readonly host: "desktop";
  /** The shell's own version, for diagnostics and for a minimum-shell check. */
  readonly version: string;
  readonly platform: string;
  /** The open document and its snapshot, or null when the shell has none. */
  loadDocument(): Promise<{ info: BridgeDocumentInfo; snapshot: Uint8Array } | null>;
  saveDocument(request: BridgeSaveRequest): Promise<void>;
  /** Wait for anything queued to reach the disk. */
  flushDocument(): Promise<{ ok: true } | BridgeFailure>;
  documentInfo(): Promise<BridgeDocumentInfo | null>;
  appInfo(): Promise<{ host: "desktop"; version: string; platform: string }>;
  /**
   * Create a new document and open the window on it.
   *
   * On the desktop the *file* is the document, and a workspace id in the address bar
   * means nothing: the session comes from whatever the shell has open. So "New canvas"
   * cannot be a navigation — it has to ask the shell to make a file, which is what this
   * is for. The seed carries everything the first write needs, so main never has to
   * invent a document it cannot describe.
   */
  createDocument(seed: BridgeCreateRequest): Promise<BridgeCreateResult>;
  /** Show the open dialog and open the choice. The renderer passes no path. */
  openFileDialog(): Promise<void>;
  /** Open a path this shell reported earlier, re-validated in main. */
  openDocument(path: string): Promise<void>;
  recentFiles(): Promise<readonly BridgeRecentFile[]>;
  forgetRecent(path: string): Promise<void>;
}

export type HostKind = "web" | "desktop";

/**
 * A method, as opposed to the three values that identify the host.
 *
 * The distinction matters: a shell from an older build still publishes `host`
 * and `version`, so only the callable half can tell a usable bridge from a stale
 * one.
 */
export type BridgeMethod = Exclude<keyof DesktopBridge, "host" | "version" | "platform">;

/**
 * What this build of the renderer calls, and therefore needs.
 *
 * A window left open by a previous build keeps the preload it loaded at launch,
 * so a method added since then is simply absent. Without this list the renderer
 * asks for it, the call is `undefined`, and the window does nothing at all.
 */
export const REQUIRED_BRIDGE_METHODS = [
  "loadDocument",
  "saveDocument",
  "flushDocument",
  "documentInfo",
  "appInfo",
  "createDocument",
  "openFileDialog",
  "openDocument",
  "recentFiles",
  "forgetRecent",
] as const satisfies readonly BridgeMethod[];

interface BridgeScope {
  readonly suiteDesktop?: unknown;
}

/**
 * The bridge, when a desktop shell is hosting this renderer.
 *
 * The scope is a parameter so the answer is a test rather than something that
 * depends on how the test runner was started.
 */
export function desktopBridge(
  scope: BridgeScope = globalThis as unknown as BridgeScope,
): DesktopBridge | null {
  const candidate = scope.suiteDesktop;
  if (typeof candidate !== "object" || candidate === null) return null;
  const bridge = candidate as Partial<DesktopBridge>;
  // Only the host marker is required to identify the shell. A missing method is
  // a version mismatch the caller sees, not a reason to pretend to be a browser
  // and quietly write somewhere else.
  return bridge.host === "desktop" && typeof bridge.version === "string"
    ? (bridge as DesktopBridge)
    : null;
}

/** `"desktop"` when a bridge is present, otherwise `"web"`. */
export function hostKind(scope?: BridgeScope): HostKind {
  return desktopBridge(scope) === null ? "web" : "desktop";
}

/**
 * The methods a bridge does not publish.
 *
 * Empty means the shell beside this renderer is current enough to boot. A
 * non-empty answer is a version mismatch the person has to see: the window is
 * from a previous build, and only a restart replaces it.
 */
export function bridgeMissing(
  bridge: DesktopBridge,
  required: readonly BridgeMethod[] = REQUIRED_BRIDGE_METHODS,
): readonly BridgeMethod[] {
  return required.filter((method) => typeof bridge[method] !== "function");
}
