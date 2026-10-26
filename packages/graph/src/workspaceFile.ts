import { LoroDoc } from "loro-crdt";
import { err, ok, Result } from "neverthrow";
import { z } from "zod";
import { documentAttachments } from "./cardAttachments.js";
import { SCHEMA_VERSION, WorkspaceDocument } from "./loro/WorkspaceDocument.js";

/**
 * The envelope a `.suite` backup uses. The document itself is opaque to readers.
 *
 * Version 2 added `attachments`. The file is this product's only backup, so an
 * image that lives beside the document has to travel inside it; a v1 file has
 * no `attachments` key and still imports (the key defaults to `{}`).
 */
export const WORKSPACE_FILE_KIND = "suite.workspace";
export const WORKSPACE_FILE_VERSION = 2;

export const workspaceFileManifestSchema = z.object({
  boards: z.number().int().nonnegative(),
  cards: z.number().int().nonnegative(),
  types: z.number().int().nonnegative(),
  tags: z.number().int().nonnegative(),
});

/**
 * One image's bytes, beside the document but *inside* the file. The node in the
 * document carries the same id, so import can put the bytes back where the card
 * looks for them.
 */
export const workspaceFileAttachmentSchema = z.object({
  mime: z.string().min(1),
  /** Alt text, as the node carries it; may be empty when the node had none. */
  name: z.string(),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  /** Base64 of the exact bytes, so a round trip is byte-for-byte. */
  data: z.string().min(1),
});

export const workspaceFileSchema = z.object({
  kind: z.literal(WORKSPACE_FILE_KIND),
  version: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string().min(1),
  workspaceId: z.string().min(1),
  /** Base64 of `doc.export({ mode: "snapshot" })`. */
  document: z.string().min(1),
  manifest: workspaceFileManifestSchema,
  /** Absent in a v1 file, which was written before images were embedded. */
  attachments: z.record(z.string(), workspaceFileAttachmentSchema).default({}),
});

export type WorkspaceFileManifest = z.infer<typeof workspaceFileManifestSchema>;
export type WorkspaceFileAttachment = z.infer<typeof workspaceFileAttachmentSchema>;
/** The envelope's `attachments` section, keyed by the node's id. */
export type WorkspaceFileAttachments = Record<string, WorkspaceFileAttachment>;
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;

/** One attachment's bytes, ready to embed. */
export interface WorkspaceFileAttachmentInput {
  mime: string;
  name: string;
  width: number | null;
  height: number | null;
  bytes: Uint8Array;
}

export type WorkspaceFileAttachmentInputs = Record<string, WorkspaceFileAttachmentInput>;

/** One attachment decoded from an envelope, keyed by the id the node carries. */
export interface WorkspaceFileAttachmentBytes extends WorkspaceFileAttachmentInput {
  id: string;
}

export interface WorkspaceFileExport {
  file: WorkspaceFile;
  /** Pretty JSON, ready for download. */
  json: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Snapshot plus a small manifest, so a person can see what the file holds. */
export function createWorkspaceFile(
  workspaceId: string,
  workspace: WorkspaceDocument,
  exportedAt = new Date().toISOString(),
  attachments: WorkspaceFileAttachmentInputs = {},
): WorkspaceFileExport {
  const file: WorkspaceFile = {
    kind: WORKSPACE_FILE_KIND,
    version: WORKSPACE_FILE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    workspaceId,
    document: bytesToBase64(workspace.doc.export({ mode: "snapshot" })),
    manifest: {
      boards: workspace.listBoards().length,
      cards: workspace.listCards().length,
      types: workspace.listTypes().length,
      tags: workspace.listTags().length,
    },
    attachments: Object.fromEntries(
      Object.entries(attachments).map(([id, input]) => [
        id,
        {
          mime: input.mime,
          name: input.name,
          width: input.width,
          height: input.height,
          data: bytesToBase64(input.bytes),
        },
      ]),
    ),
  };
  return { file, json: JSON.stringify(file, null, 2) };
}

/** What a fresh document plus its envelope looks like once a file has been read. */
export interface ParsedWorkspaceFile {
  file: WorkspaceFile;
  workspace: WorkspaceDocument;
  attachments: WorkspaceFileAttachmentBytes[];
  /**
   * Images the document references that this file cannot supply, with every
   * card that shows them. Import must report these: an image that quietly
   * vanishes from the only backup is the loss the format exists to prevent.
   */
  damaged: DamagedWorkspaceAttachment[];
}

/** Why an image's bytes are not in the file. */
export type DamagedAttachmentReason =
  /** The envelope has an entry for the id, but its base64 does not decode. */
  | "corrupt"
  /** The envelope has no entry at all — the bytes were never written or were removed. */
  | "absent";

/** A referenced image this backup cannot restore, named the way a reader knows it. */
export interface DamagedWorkspaceAttachment {
  id: string;
  /** Alt text from the node, when it had one. */
  name: string | null;
  reason: DamagedAttachmentReason;
  /** Every card whose body or title draws the image; the titles are for humans. */
  cards: Array<{ id: string; title: string }>;
}

function quoteTitle(title: string): string {
  return `“${title}”`;
}

/**
 * The one sentence import shows for damaged images: which cards, not which ids.
 * `null` when the file is complete, so a caller can show nothing at all.
 */
export function damagedAttachmentWarning(
  damaged: readonly DamagedWorkspaceAttachment[],
): string | null {
  if (damaged.length === 0) return null;
  const titles = [...new Set(damaged.flatMap((entry) => entry.cards.map((card) => card.title)))];
  const images = damaged.length === 1 ? "1 image" : `${damaged.length} images`;
  const were = damaged.length === 1 ? "was" : "were";
  const noun = titles.length === 1 ? "card" : "cards";
  const named = titles.length === 0 ? "" : ` in ${noun} ${titles.map(quoteTitle).join(", ")}`;
  return `${images} could not be restored${named}: ${were} missing or unreadable in this backup. Everything else imported; ${damaged.length === 1 ? "that image" : "those images"} will show a placeholder.`;
}

/**
 * Why a file could not be read. `kind` is for code that branches, `message` is
 * the sentence a reader is shown — the two must agree.
 */
export interface WorkspaceFileError {
  kind: "not-a-backup" | "invalid-json" | "newer-file" | "newer-schema" | "corrupt";
  message: string;
}

/** The version checks a backup has to pass before its document is opened. */
function incompatibility(file: WorkspaceFile): WorkspaceFileError | null {
  if (file.version > WORKSPACE_FILE_VERSION) {
    return {
      kind: "newer-file",
      message: `This backup was made by a newer Suite (file version ${file.version}); this build supports ${WORKSPACE_FILE_VERSION}.`,
    };
  }
  if (file.schemaVersion > SCHEMA_VERSION) {
    return {
      kind: "newer-schema",
      message: `This backup uses schema ${file.schemaVersion}; this build supports ${SCHEMA_VERSION}.`,
    };
  }
  return null;
}

/**
 * Validates the envelope and returns a fresh document, or why it could not.
 * Import is deliberately never merged into an open document: the caller gives
 * it a new workspace id.
 *
 * `attachments` are the envelope's images, decoded. An entry whose base64 is
 * unreadable is skipped rather than failing the whole backup: losing one image
 * must not cost the user the text that came with it.
 */
export function tryParseWorkspaceFile(
  input: unknown,
): Result<ParsedWorkspaceFile, WorkspaceFileError> {
  const parsed = workspaceFileSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      kind: "not-a-backup",
      message: "This is not a Suite workspace backup. Choose a file exported from Suite.",
    });
  }
  const problem = incompatibility(parsed.data);
  if (problem) return err(problem);

  const doc = new LoroDoc();
  const imported = Result.fromThrowable(
    () => doc.import(base64ToBytes(parsed.data.document)),
    (): WorkspaceFileError => ({
      kind: "corrupt",
      message: "This Suite backup is corrupt and could not be read.",
    }),
  )();
  if (imported.isErr()) return err(imported.error);

  const attachments: WorkspaceFileAttachmentBytes[] = [];
  const unreadable = new Set<string>();
  for (const [id, entry] of Object.entries(parsed.data.attachments)) {
    const bytes = Result.fromThrowable(() => base64ToBytes(entry.data))();
    if (bytes.isErr()) {
      // Recorded, not dropped: the caller can name the card that will show a
      // placeholder, while the document itself still imports.
      unreadable.add(id);
      continue;
    }
    attachments.push({
      id,
      mime: entry.mime,
      name: entry.name,
      width: entry.width,
      height: entry.height,
      bytes: bytes.value,
    });
  }

  // Every id the document references but the file cannot supply. Recomputed
  // from the imported document rather than from the envelope, so an entry for
  // an id no card uses is not a problem and a missing one that a card does use
  // always is.
  const restoredWorkspace = new WorkspaceDocument(doc);
  const damaged: DamagedWorkspaceAttachment[] = [];
  for (const referenced of documentAttachments(restoredWorkspace)) {
    if (attachments.some((entry) => entry.id === referenced.id)) continue;
    damaged.push({
      id: referenced.id,
      name: referenced.name,
      reason: unreadable.has(referenced.id) ? "corrupt" : "absent",
      cards: referenced.cards.map((card) => ({ id: card.id, title: card.title })),
    });
  }

  return ok({ file: parsed.data, workspace: restoredWorkspace, attachments, damaged });
}

/** Reads the JSON a backup file holds, or why it is not JSON. */
export function tryReadWorkspaceFile(
  text: string,
): Result<ParsedWorkspaceFile, WorkspaceFileError> {
  return Result.fromThrowable(
    () => JSON.parse(text) as unknown,
    (): WorkspaceFileError => ({
      kind: "invalid-json",
      message: "This file is not valid JSON, so it is not a Suite backup.",
    }),
  )().andThen(tryParseWorkspaceFile);
}

/**
 * Throwing form of `tryParseWorkspaceFile`, for callers that treat an unreadable
 * backup as exceptional. The message is the error's own sentence.
 */
export function parseWorkspaceFile(input: unknown): ParsedWorkspaceFile {
  return unwrapFile(tryParseWorkspaceFile(input));
}

/** Throwing form of `tryReadWorkspaceFile`. */
export function readWorkspaceFile(text: string): ParsedWorkspaceFile {
  return unwrapFile(tryReadWorkspaceFile(text));
}

function unwrapFile(result: Result<ParsedWorkspaceFile, WorkspaceFileError>): ParsedWorkspaceFile {
  if (result.isErr()) throw new Error(result.error.message);
  return result.value;
}
