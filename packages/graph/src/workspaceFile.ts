import { LoroDoc } from "loro-crdt";
import { z } from "zod";
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

function assertCompatible(file: WorkspaceFile): void {
  if (file.version > WORKSPACE_FILE_VERSION) {
    throw new Error(
      `This backup was made by a newer Suite (file version ${file.version}); this build supports ${WORKSPACE_FILE_VERSION}.`,
    );
  }
  if (file.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `This backup uses schema ${file.schemaVersion}; this build supports ${SCHEMA_VERSION}.`,
    );
  }
}

/**
 * Validates the envelope and returns a fresh document. Import is deliberately
 * never merged into an open document: the caller gives it a new workspace id.
 *
 * `attachments` are the envelope's images, decoded. An entry whose base64 is
 * unreadable is skipped rather than failing the whole backup: losing one image
 * must not cost the user the text that came with it.
 */
export function parseWorkspaceFile(input: unknown): {
  file: WorkspaceFile;
  workspace: WorkspaceDocument;
  attachments: WorkspaceFileAttachmentBytes[];
} {
  const parsed = workspaceFileSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("This is not a Suite workspace backup. Choose a file exported from Suite.");
  }
  assertCompatible(parsed.data);
  const doc = new LoroDoc();
  try {
    doc.import(base64ToBytes(parsed.data.document));
  } catch {
    throw new Error("This Suite backup is corrupt and could not be read.");
  }
  const attachments: WorkspaceFileAttachmentBytes[] = [];
  for (const [id, entry] of Object.entries(parsed.data.attachments)) {
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(entry.data);
    } catch {
      continue;
    }
    attachments.push({
      id,
      mime: entry.mime,
      name: entry.name,
      width: entry.width,
      height: entry.height,
      bytes,
    });
  }
  return { file: parsed.data, workspace: new WorkspaceDocument(doc), attachments };
}

export function readWorkspaceFile(text: string): {
  file: WorkspaceFile;
  workspace: WorkspaceDocument;
  attachments: WorkspaceFileAttachmentBytes[];
} {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON, so it is not a Suite backup.");
  }
  return parseWorkspaceFile(value);
}
