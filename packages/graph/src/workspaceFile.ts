import { LoroDoc } from "loro-crdt";
import { z } from "zod";
import { SCHEMA_VERSION, WorkspaceDocument } from "./loro/WorkspaceDocument.js";

/** The envelope a `.suite` backup uses. The document itself is opaque to readers. */
export const WORKSPACE_FILE_KIND = "suite.workspace";
export const WORKSPACE_FILE_VERSION = 1;

export const workspaceFileManifestSchema = z.object({
  boards: z.number().int().nonnegative(),
  cards: z.number().int().nonnegative(),
  types: z.number().int().nonnegative(),
  tags: z.number().int().nonnegative(),
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
});

export type WorkspaceFileManifest = z.infer<typeof workspaceFileManifestSchema>;
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;

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
 */
export function parseWorkspaceFile(input: unknown): {
  file: WorkspaceFile;
  workspace: WorkspaceDocument;
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
  return { file: parsed.data, workspace: new WorkspaceDocument(doc) };
}

export function readWorkspaceFile(text: string): {
  file: WorkspaceFile;
  workspace: WorkspaceDocument;
} {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON, so it is not a Suite backup.");
  }
  return parseWorkspaceFile(value);
}
