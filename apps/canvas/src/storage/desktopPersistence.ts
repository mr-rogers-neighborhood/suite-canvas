import { documentAttachments, WorkspaceDocument } from "@suite/graph";
import type { LoroDoc } from "loro-crdt";
import type { BridgeAttachment, DesktopBridge } from "../host/bridge";
import { defaultAttachmentSources } from "../session/attachmentBytes";
import { gatherAttachments } from "../session/workspaceTransfer";

/**
 * The local copy, when the main process holds it.
 *
 * Same three methods as the IndexedDB adapter, because the store does not learn
 * where its document lives. What changes is who decides: the main process owns
 * the file, the lock, the backups and the mtime guard, so this adapter's whole
 * job is to move bytes and to report a refusal it cannot handle itself.
 *
 * `subscribeLocalUpdates` is the hook, not `subscribe`: the latter also fires for
 * an update that arrived from the relay, and writing those back through the file
 * would turn a sync into a save. The adapter's updates are exactly the edits made
 * in this window.
 */

/** How long a flush waits for the main process before giving up on it. */
const FLUSH_TIMEOUT_MS = 5_000;

export interface DesktopPersistenceOptions {
  /** Called when the main process refuses a write it will not retry. */
  readonly onFailure?: (failure: { code: string; message: string }) => void;
}

export class LoroDesktopPersistence {
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;
  private loaded = false;
  private pending: Uint8Array | null = null;
  private writing: Promise<void> = Promise.resolve();
  /**
   * The attachment ids the shell already holds.
   *
   * A save sends the images only when this set changes, so a routine autosave
   * does not re-read every pasted photo out of IndexedDB. The shell keeps the
   * last set it was given, so a document-only save preserves them.
   */
  private sentAttachments: string | null = null;

  constructor(
    private readonly workspaceId: string,
    private readonly doc: LoroDoc,
    private readonly bridge: DesktopBridge,
    private readonly options: DesktopPersistenceOptions = {},
  ) {}

  /**
   * Hydrate from the file and start forwarding edits.
   *
   * The snapshot arrives from the main process rather than being read here: the
   * renderer has no filesystem, which is the whole point of the split.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    const opened = await this.bridge.loadDocument();
    if (opened) {
      // Importing is not an edit: it must not be forwarded back as one.
      this.doc.import(opened.snapshot);
    }
    this.loaded = true;
    this.subscribe();

    // A workspace with no file yet — the launcher just made one — is written
    // now, so the file exists before the first keystroke and a crash on an empty
    // document still leaves something to reopen.
    if (!opened) await this.write(true);
  }

  private subscribe(): void {
    this.unsubscribe = this.doc.subscribeLocalUpdates((update: Uint8Array) => {
      if (this.destroyed) return;
      // The main process writes whole snapshots, so an update only has to say
      // "there is something new"; the snapshot is taken at flush time, when the
      // edits have settled, rather than once per keystroke.
      this.pending = update;
      void this.write();
    });
  }

  /** Serialise a snapshot from the live document. */
  private snapshot(): Uint8Array {
    return new Uint8Array(this.doc.export({ mode: "snapshot" }));
  }

  private async write(force = false): Promise<void> {
    if (this.destroyed) return;
    if (!force && this.pending === null) return;
    this.pending = null;
    const title = this.title();
    this.writing = this.writing.then(async () => {
      // `undefined` means "unchanged since the last save", and the shell keeps
      // what it was given; an explicit list replaces it.
      const attachments = await this.refreshAttachments();
      await this.bridge.saveDocument({
        workspaceId: this.workspaceId,
        ...(title === undefined ? {} : { title }),
        snapshot: this.snapshot(),
        manifest: this.manifest(),
        ...(attachments === undefined ? {} : { attachments }),
      });
    });
    await this.writing.catch((error: unknown) => {
      this.options.onFailure?.({
        code: "write-failed",
        message: error instanceof Error ? error.message : "The document could not be saved.",
      });
    });
  }

  /**
   * What the file says it holds.
   *
   * Counted here rather than in main so the main process keeps no copy of the
   * document. It is a manifest a person reads, not a permission.
   */
  private manifest(): { boards: number; cards: number; types: number; tags: number } {
    const state = this.doc.toJSON() as Record<string, unknown> | null;
    const count = (key: string): number => {
      const value = state?.[key];
      return value && typeof value === "object" ? Object.keys(value).length : 0;
    };
    return {
      boards: count("boards"),
      cards: count("cards"),
      types: count("types"),
      tags: count("tags"),
    };
  }

  /**
   * Collect image bytes when the set of referenced images changed.
   *
   * The document references images by id; the bytes live wherever the editor put
   * them. Gathering is asynchronous and can be slow, so it happens only when the
   * referenced set differs from what the shell already has.
   *
   * A missing image is reported and skipped: a photo whose bytes are gone must
   * not stop the text beside it from being saved.
   */
  private async refreshAttachments(): Promise<readonly BridgeAttachment[] | undefined> {
    const referenced = documentAttachments(new WorkspaceDocument(this.doc))
      .map((entry) => entry.id)
      .sort();
    const key = referenced.join(",");
    // Unchanged since the last save: nothing to say, so say nothing.
    if (this.sentAttachments === key) return undefined;

    try {
      const gathered = await gatherAttachments(
        new WorkspaceDocument(this.doc),
        defaultAttachmentSources(),
      );
      const attachments = Object.entries(gathered.attachments).map(([id, entry]) => ({
        id,
        mime: entry.mime,
        name: entry.name,
        width: entry.width,
        height: entry.height,
        bytes: entry.bytes,
      }));
      this.sentAttachments = key;

      if (gathered.missing.length > 0) {
        const titles = [
          ...new Set(gathered.missing.flatMap((entry) => entry.cards.map((card) => card.title))),
        ];
        this.options.onFailure?.({
          code: "missing-attachment",
          message:
            `${gathered.missing.length} image${gathered.missing.length === 1 ? "" : "s"} could not be ` +
            `read and ${gathered.missing.length === 1 ? "is" : "are"} not in this file` +
            (titles.length === 0 ? "." : `: ${titles.join(", ")}.`),
        });
      }
      return attachments;
    } catch (error) {
      // Gathering failing must not cost the document: omit the section this
      // time, and try again on the next change to the referenced set.
      this.sentAttachments = null;
      this.options.onFailure?.({
        code: "attachment-failed",
        message: error instanceof Error ? error.message : "Images could not be read.",
      });
      return undefined;
    }
  }

  /**
   * The workspace's name, for the file a new document creates.
   *
   * Read from the document rather than from the recents mirror: the name in the
   * document is the one that travelled with the work.
   */
  private title(): string | undefined {
    try {
      const name = new WorkspaceDocument(this.doc).workspaceName().trim();
      return name.length > 0 ? name : undefined;
    } catch {
      return undefined;
    }
  }

  /** Push the newest state and wait for the main process to write it. */
  async flush(): Promise<void> {
    if (this.destroyed) return;
    if (this.pending !== null) await this.write();
    await this.writing.catch(() => {
      // Reported through `onFailure` when it happened; a flush must not throw
      // into an unload handler.
    });

    const timeout = new Promise<{ ok: true }>((resolve) => {
      setTimeout(() => resolve({ ok: true }), FLUSH_TIMEOUT_MS);
    });
    const result = await Promise.race([this.bridge.flushDocument(), timeout]).catch(() => null);
    if (result && "ok" in result && result.ok === false) {
      this.options.onFailure?.({ code: result.code, message: result.message });
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
