/**
 * The one place the two processes agree on names.
 *
 * Every channel is a capability handed to the renderer, so the list is short and
 * each entry says what it is for. A handler that is not named here does not
 * exist as far as the preload is concerned, which is the point: `ipcMain.handle`
 * can be called from anywhere in main, but only these five are reachable.
 */

export const IPC = {
  /** The open document's identity and initial snapshot, or null when none is open. */
  loadDocument: "suite:document:load",
  /** Replace the open document's contents. Debounced in main, not here. */
  saveDocument: "suite:document:save",
  /** Wait for anything queued to reach the disk. */
  flushDocument: "suite:document:flush",
  /** Where the open document lives, for the window title and the File menu. */
  documentInfo: "suite:document:info",
  /** The shell's own version and platform, for diagnostics. */
  appInfo: "suite:app:info",
  /** Show the open dialog and open whatever is chosen. */
  openFileDialog: "suite:document:pick",
  /** Open a path the shell reported earlier, after re-validating it. */
  openDocument: "suite:document:open",
  /** Files this machine opened, newest first. */
  recentFiles: "suite:document:recents",
  /** Drop one entry from that list. */
  forgetRecent: "suite:document:forget",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** What the renderer is told when it asks what is open. */
export interface OpenDocumentInfo {
  /** The workspace id the renderer keys its store by; carried in the page URL. */
  readonly workspaceId: string;
  /** Absolute path on disk. Shown in the title bar, never used to build one. */
  readonly path: string;
  readonly name: string;
  /** True when this open converted a legacy `.suite` canvas file. */
  readonly migratedFrom: string | null;
  /** True when the file needed a backup or recovery to open. */
  readonly recoveredFrom: string | null;
}

/**
 * What the renderer sends to be written.
 *
 * The renderer owns the document and the attachments, so it supplies both. Main
 * assembles the envelope, writes it atomically and keeps the attachment section
 * it was last given, so a routine autosave does not re-encode megabytes of images.
 */
export interface SaveDocumentRequest {
  readonly workspaceId: string;
  /** The workspace's own name, used to name the file on its first save. */
  readonly title?: string;
  /** A Loro snapshot, as bytes over IPC. */
  readonly snapshot: Uint8Array;
  readonly manifest: {
    readonly boards: number;
    readonly cards: number;
    readonly types: number;
    readonly tags: number;
  };
  /** Present only when the attachment set changed. */
  readonly attachments?: readonly {
    readonly id: string;
    readonly mime: string;
    readonly name: string;
    readonly width: number | null;
    readonly height: number | null;
    readonly bytes: Uint8Array;
  }[];
}

/** One entry in the launcher's recent list. */
export interface RecentFileInfo {
  readonly path: string;
  readonly name: string;
  /** The containing directory, shown so a person can find the file. */
  readonly folder: string;
  readonly openedAt: number;
}

export interface AppInfo {
  readonly host: "desktop";
  readonly version: string;
  readonly platform: NodeJS.Platform;
}

/** Every refusal a file operation can produce, as a value rather than a throw. */
export type FileFailureCode =
  | "no-document"
  | "locked"
  | "too-large"
  | "not-a-document"
  | "corrupt"
  | "write-failed"
  | "changed-on-disk"
  | "cancelled";

export interface FileFailure {
  readonly ok: false;
  readonly code: FileFailureCode;
  /** A sentence for the user; the code is for the code. */
  readonly message: string;
}
