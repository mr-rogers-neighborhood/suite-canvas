import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { MAX_ENVELOPE_BYTES, readEnvelopeJson } from "@suite/files";
import {
  pruneBackups,
  readFileWithLimit,
  readTextWithLimit,
  writeBackup,
  writeFileAtomic,
} from "@suite/files/node";
import {
  buildWorkspaceFile,
  needsWorkspaceFileMigration,
  readWorkspaceFile,
  type WorkspaceFileAttachmentInputs,
  type WorkspaceFileManifest,
  workspaceFileSchema,
} from "@suite/graph";
import { z } from "zod";
import type { FileFailure, OpenDocumentInfo, SaveDocumentRequest } from "../shared/ipc.js";
import { acquireLock, type FileLock, isFile } from "./lock.js";
import { type DesktopPaths, desktopPaths, fileStem } from "./paths.js";

/**
 * The file, as a desktop application sees it.
 *
 * The renderer owns the document — it already has the schema, the editors and
 * the attachment store — so this is a **file** authority, not a document
 * authority. It owns exactly the things a renderer cannot: the lock, the atomic
 * write, the backups, the mtime guard, and the decision about which file to open
 * when the one you asked for is damaged.
 *
 * That boundary is why a save is a payload rather than a round trip of edits: a
 * canvas file carries its images inside it, and the renderer is the only side
 * that knows where they are.
 */

/** How long a save waits for the next edit before it touches the disk. */
export const DEBOUNCE_MS = 400;

export const AUTOSAVE_SUFFIX = ".canvas";

const saveRequestSchema = z.object({
  workspaceId: z.string().min(1),
  snapshot: z.instanceof(Uint8Array),
  manifest: z.object({
    boards: z.number().int().nonnegative(),
    cards: z.number().int().nonnegative(),
    types: z.number().int().nonnegative(),
    tags: z.number().int().nonnegative(),
  }),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1),
        mime: z.string().min(1),
        name: z.string(),
        width: z.number().int().nonnegative().nullable(),
        height: z.number().int().nonnegative().nullable(),
        bytes: z.instanceof(Uint8Array),
      }),
    )
    .optional(),
});

export type OpenResult =
  | {
      readonly ok: true;
      readonly store: DocumentStore;
      /** Snapshot bytes for the renderer to import. */
      readonly snapshot: Uint8Array;
      readonly info: OpenDocumentInfo;
    }
  | FileFailure;

export interface OpenOptions {
  readonly appId?: string;
  readonly paths?: DesktopPaths;
  readonly now?: () => number;
  readonly debounceMs?: number;
}

function failure(code: FileFailure["code"], message: string): FileFailure {
  return { ok: false, code, message };
}

function toAttachmentInputs(
  attachments: SaveDocumentRequest["attachments"],
): WorkspaceFileAttachmentInputs {
  return Object.fromEntries(
    (attachments ?? []).map((entry) => [
      entry.id,
      {
        mime: entry.mime,
        name: entry.name,
        width: entry.width,
        height: entry.height,
        bytes: entry.bytes,
      },
    ]),
  );
}

/** The default file name for a document opened without a path. */
export function defaultDocumentPath(library: string, workspaceId: string): string {
  return join(library, `${workspaceId}${AUTOSAVE_SUFFIX}`);
}

/** Whether a path names a canvas document, by extension. */
export function looksLikeCanvasFile(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === ".canvas" || extension === ".suite" || extension === ".json";
}

/** One candidate a recovery may try, newest first. */
async function backupCandidates(path: string): Promise<readonly string[]> {
  const directory = dirname(path);
  const base = basename(path);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const prefix = `${base}.`;
  const suffix = ".bak";
  const stamped = names
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => ({ name, stamp: name.slice(prefix.length, name.length - suffix.length) }))
    // The stamp sorts lexically because it is ISO with dashes.
    .sort((left, right) => (left.stamp < right.stamp ? 1 : -1));
  return stamped.map((entry) => join(directory, entry.name));
}

export class DocumentStore {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> | null = null;
  private pending: SaveDocumentRequest | null = null;
  private attachments: WorkspaceFileAttachmentInputs;
  private manifest: WorkspaceFileManifest;
  private lastWritten: { mtimeMs: number; size: number } | null = null;
  private closed = false;
  private failure: FileFailure | null = null;
  lastBackupDay: string | null = null;
  private snapshot: Uint8Array;

  private constructor(
    private readonly path: string,
    private readonly info: OpenDocumentInfo,
    private readonly lock: FileLock | null,
    snapshot: Uint8Array,
    manifest: WorkspaceFileManifest,
    attachments: WorkspaceFileAttachmentInputs,
    private readonly debounceMs: number,
    private readonly now: () => number,
  ) {
    this.snapshot = snapshot;
    this.manifest = manifest;
    this.attachments = attachments;
  }

  /** Where the document lives and what it is called. */
  get documentInfo(): OpenDocumentInfo {
    return this.info;
  }

  /** The last structural refusal, if the store has stopped writing. */
  get lastFailure(): FileFailure | null {
    return this.failure;
  }

  /**
   * Open a file, converting a legacy envelope and recovering from a backup when
   * the file itself will not parse.
   *
   * A damaged file is never replaced by an empty one: if nothing usable is
   * found the open fails and the file is left exactly as it was, because the
   * bytes on disk are the only copy the user has.
   */
  static async open(path: string, options: OpenOptions = {}): Promise<OpenResult> {
    const paths = options.paths ?? desktopPaths();
    const now = options.now ?? Date.now;

    const lockOutcome = await acquireLock(path, paths.locks, {
      ...(options.appId === undefined ? {} : { appId: options.appId }),
      now,
    });
    if (!lockOutcome.ok) {
      return failure(
        "locked",
        `${basename(path)} is already open in another Suite window${
          lockOutcome.holder.hostname === "" ? "" : ` on ${lockOutcome.holder.hostname}`
        }. Close it there first, or open a copy.`,
      );
    }

    const parsed = await DocumentStore.readEnvelope(path).catch(() => null);

    if (parsed) {
      const converted = await DocumentStore.convertIfNeeded(path, parsed.text, parsed.file);
      const snapshot = parsed.snapshot;
      const store = new DocumentStore(
        converted.path,
        {
          workspaceId: parsed.file.workspaceId,
          path: converted.path,
          name: basename(converted.path),
          migratedFrom: converted.from,
          recoveredFrom: null,
        },
        lockOutcome.lock,
        snapshot,
        parsed.file.manifest,
        parsed.attachments,
        options.debounceMs ?? DEBOUNCE_MS,
        now,
      );
      await store.rememberWrittenFile();
      await store.backupOnOpen();
      return { ok: true, store, snapshot, info: store.info };
    }

    // The file itself would not parse. Try the backups, newest first, and open
    // the first one that does — without touching the damaged file.
    for (const candidate of await backupCandidates(path)) {
      const recovered = await DocumentStore.readEnvelope(candidate).catch(() => null);
      if (!recovered) continue;
      const store = new DocumentStore(
        path,
        {
          workspaceId: recovered.file.workspaceId,
          path,
          name: basename(path),
          migratedFrom: null,
          recoveredFrom: basename(candidate),
        },
        lockOutcome.lock,
        recovered.snapshot,
        recovered.file.manifest,
        recovered.attachments,
        options.debounceMs ?? DEBOUNCE_MS,
        now,
      );
      await store.rememberWrittenFile();
      return { ok: true, store, snapshot: recovered.snapshot, info: store.info };
    }

    await lockOutcome.lock.release();
    return failure(
      "corrupt",
      `${basename(path)} could not be read and none of its backups could be either. ` +
        "The file has been left untouched.",
    );
  }

  /**
   * Start a document that does not exist yet.
   *
   * A new workspace has no file until its first save, and that save is what
   * makes one: the path is chosen here, from the title, so the file is named
   * after the work rather than after a generated id. A name already taken gets a
   * suffix instead of a prompt — the launcher asked for a new workspace, not for
   * a file dialog.
   */
  static async create(
    path: string,
    request: SaveDocumentRequest,
    options: OpenOptions = {},
  ): Promise<OpenResult> {
    const paths = options.paths ?? desktopPaths();
    const now = options.now ?? Date.now;

    const lockOutcome = await acquireLock(path, paths.locks, {
      ...(options.appId === undefined ? {} : { appId: options.appId }),
      now,
    });
    if (!lockOutcome.ok) {
      return failure("locked", `${basename(path)} is already open in another Suite window.`);
    }

    const envelope = buildWorkspaceFile({
      workspaceId: request.workspaceId,
      snapshot: request.snapshot,
      manifest: request.manifest,
      attachments: toAttachmentInputs(request.attachments),
    });
    try {
      // The library may not exist yet — a first document on a fresh install is exactly the
      // case this is for. `writeFileAtomic` replaces a file and does not create a directory,
      // so without this the very first canvas anyone makes fails with "could not be created".
      await mkdir(dirname(path), { recursive: true });
      await writeFileAtomic(path, new TextEncoder().encode(JSON.stringify(envelope, null, 2)));
    } catch {
      await lockOutcome.lock.release();
      return failure("write-failed", `${basename(path)} could not be created.`);
    }

    const store = new DocumentStore(
      path,
      {
        workspaceId: request.workspaceId,
        path,
        name: basename(path),
        migratedFrom: null,
        recoveredFrom: null,
      },
      lockOutcome.lock,
      request.snapshot,
      request.manifest,
      toAttachmentInputs(request.attachments),
      options.debounceMs ?? DEBOUNCE_MS,
      now,
    );
    await store.rememberWrittenFile();
    store.lastBackupDay = new Date(now()).toISOString().slice(0, 10);
    return { ok: true, store, snapshot: request.snapshot, info: store.info };
  }

  /** Read one envelope from disk, with the structural checks a file must pass. */
  private static async readEnvelope(path: string): Promise<{
    file: {
      workspaceId: string;
      manifest: WorkspaceFileManifest;
    };
    text: string;
    snapshot: Uint8Array;
    attachments: WorkspaceFileAttachmentInputs;
  }> {
    const text = await readTextWithLimit(path, MAX_ENVELOPE_BYTES);
    const structural = readEnvelopeJson(workspaceFileSchema, text);
    if (!structural.ok) throw new Error("not an envelope");

    // The full parse is what proves the snapshot is a document rather than
    // bytes that happen to be base64.
    const parsed = readWorkspaceFile(text);
    return {
      file: { workspaceId: parsed.file.workspaceId, manifest: parsed.file.manifest },
      text,
      snapshot: new Uint8Array(parsed.workspace.exportSnapshot()),
      attachments: Object.fromEntries(
        parsed.attachments.map((entry) => [
          entry.id,
          {
            mime: entry.mime,
            name: entry.name,
            width: entry.width,
            height: entry.height,
            bytes: entry.bytes,
          },
        ]),
      ),
    };
  }

  /**
   * Write the `.canvas` beside a legacy file and keep the original.
   *
   * Silent, because a wizard for a rename is noise: the file opens, and the next
   * save goes to the new path. The original stays until the new file has been
   * validated, and it stays afterwards too — deleting the only copy of a user's
   * work to tidy up an extension is not a trade this product makes.
   */
  private static async convertIfNeeded(
    path: string,
    text: string,
    file: { workspaceId: string },
  ): Promise<{ path: string; from: string | null }> {
    const parsed = readWorkspaceFile(text);
    if (!needsWorkspaceFileMigration(parsed.file)) return { path, from: null };
    if (extname(path).toLowerCase() === AUTOSAVE_SUFFIX) return { path, from: null };

    const target = join(dirname(path), `${basename(path, extname(path))}${AUTOSAVE_SUFFIX}`);
    const migration = readWorkspaceFile(text);
    const converted = buildWorkspaceFile({
      workspaceId: file.workspaceId,
      snapshot: new Uint8Array(migration.workspace.exportSnapshot()),
      manifest: migration.file.manifest,
      exportedAt: migration.file.exportedAt,
      attachments: Object.fromEntries(
        migration.attachments.map((entry) => [
          entry.id,
          {
            mime: entry.mime,
            name: entry.name,
            width: entry.width,
            height: entry.height,
            bytes: entry.bytes,
          },
        ]),
      ),
    });
    await writeFileAtomic(target, new TextEncoder().encode(JSON.stringify(converted, null, 2)));
    // Prove the new file before anyone is told the open succeeded.
    await DocumentStore.readEnvelope(target);
    return { path: target, from: basename(path) };
  }

  private async rememberWrittenFile(): Promise<void> {
    try {
      const info = await stat(this.path);
      this.lastWritten = { mtimeMs: info.mtimeMs, size: info.size };
    } catch {
      this.lastWritten = null;
    }
  }

  /** One backup of the file as it was when this session opened it. */
  private async backupOnOpen(): Promise<void> {
    try {
      const info = await stat(this.path);
      if (info.size === 0) return;
      await writeBackup(this.path, new Date(this.now()));
      this.lastBackupDay = new Date(this.now()).toISOString().slice(0, 10);
    } catch {
      // A missing or unreadable file simply has nothing to back up.
    }
  }

  /**
   * Queue the document for writing.
   *
   * A request replaces any earlier one: the snapshot is the whole state, so the
   * newest is the only one that matters and writing the intermediate ones would
   * be wasted work.
   */
  save(request: SaveDocumentRequest): void {
    if (this.closed || this.failure) return;
    const validated = saveRequestSchema.safeParse(request);
    if (!validated.success) {
      this.failure = failure(
        "not-a-document",
        "The document could not be written: its shape was not a document.",
      );
      return;
    }
    this.pending = validated.data as SaveDocumentRequest;
    if (validated.data.attachments) {
      this.attachments = toAttachmentInputs(validated.data.attachments);
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writePending();
    }, this.debounceMs);
  }

  /** Write anything queued and resolve once it is on disk. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.writePending();
    if (this.writing) await this.writing;
  }

  private async writePending(): Promise<void> {
    if (this.writing) {
      await this.writing;
    }
    const request = this.pending;
    if (!request) return;
    this.pending = null;
    this.writing = this.write(request).finally(() => {
      this.writing = null;
    });
    await this.writing;
  }

  /**
   * Write one snapshot.
   *
   * The mtime guard runs first: if the file changed since this session last
   * wrote it, something outside the app has been editing — a sync client, an
   * editor, a restore — and writing now would silently discard whatever that was.
   */
  private async write(request: SaveDocumentRequest): Promise<void> {
    if (this.closed || this.failure) return;

    const current = await stat(this.path).catch(() => null);
    if (current && this.lastWritten) {
      const changed =
        Math.abs(current.mtimeMs - this.lastWritten.mtimeMs) > 1 ||
        current.size !== this.lastWritten.size;
      if (changed) {
        this.failure = failure(
          "changed-on-disk",
          `${this.info.name} changed on disk since Suite saved it. Reload before editing, so the outside change is not overwritten.`,
        );
        return;
      }
    }

    const envelope = buildWorkspaceFile({
      workspaceId: request.workspaceId,
      snapshot: request.snapshot,
      manifest: request.manifest,
      attachments: this.attachments,
    });

    try {
      await writeFileAtomic(this.path, new TextEncoder().encode(JSON.stringify(envelope, null, 2)));
    } catch {
      this.failure = failure("write-failed", `${this.info.name} could not be saved.`);
      return;
    }
    this.manifest = request.manifest;
    this.snapshot = request.snapshot;
    await this.rememberWrittenFile();
    await this.rotateDaily();
  }

  /** One backup per UTC day, pruned to the retention window. */
  private async rotateDaily(): Promise<void> {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.lastBackupDay === day) return;
    try {
      await writeBackup(this.path, new Date(this.now()));
      this.lastBackupDay = day;
      await pruneBackups(this.path);
    } catch {
      // A backup that cannot be written must not fail the save that succeeded.
    }
  }

  /** Release the lock and make sure the last write landed. */
  async close(): Promise<void> {
    if (this.closed) return;
    await this.flush();
    this.closed = true;
    await this.lock?.release();
  }

  /** The bytes last handed in, for a caller that needs the current state. */
  currentSnapshot(): Uint8Array {
    return this.snapshot;
  }

  /** The manifest last written, for the window title and diagnostics. */
  currentManifest(): WorkspaceFileManifest {
    return this.manifest;
  }
}

/** Read a file's modification time, or null when it is not there. */
export async function modificationTime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** Read the snapshot from a file without opening a session on it. */
export async function peekSnapshot(path: string): Promise<Uint8Array | null> {
  try {
    const bytes = await readFileWithLimit(path, MAX_ENVELOPE_BYTES);
    const parsed = readWorkspaceFile(new TextDecoder().decode(bytes));
    return new Uint8Array(parsed.workspace.exportSnapshot());
  } catch {
    return null;
  }
}

/**
 * The first free path for a new document, named after its workspace.
 *
 * A taken name gets a suffix rather than a dialog: the launcher asked for a new
 * workspace, and answering that with "choose a file" is a different question.
 * The loop is bounded, so a directory full of `Notes` cannot spin forever.
 */
export async function freeDocumentPath(
  library: string,
  title: string | undefined,
  workspaceId: string,
): Promise<string> {
  const stem = fileStem(title ?? workspaceId);
  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const name = attempt === 1 ? stem : `${stem} ${attempt}`;
    const candidate = join(library, `${name}${AUTOSAVE_SUFFIX}`);
    if (!(await isFile(candidate))) return candidate;
  }
  return join(library, `${stem} ${workspaceId.slice(0, 8)}${AUTOSAVE_SUFFIX}`);
}
