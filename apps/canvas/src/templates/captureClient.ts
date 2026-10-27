import {
  captureWorkspaceTemplate,
  TEMPLATE_ASSET_MAX_BYTES,
  type TemplateAssetLoader,
  type WorkspaceDocument,
  type WorkspaceTemplate,
} from "@suite/graph";
import {
  type AttachmentSource,
  defaultAttachmentSources,
  resolveAttachmentBytes,
} from "../session/attachmentBytes";
import { accountHttpBase } from "../session/endpoints";
import { isStandalone } from "../session/mode";
import { operatorToken } from "./operatorToken";

/**
 * Saving the workspace on screen as a starter template.
 *
 * It lives in the app and not the operator panel because of the pictures: their
 * bytes are in this browser's IndexedDB or on the relay, and this is the only
 * window that can read them. `captureWorkspaceTemplate` reads the document
 * through the typed layer; this module only supplies the bytes, names the
 * template, and posts it.
 *
 * The failures are the point of the file. "It did not save" is useless to a
 * person holding a token in a different tab, or one whose board is full of
 * screenshots; each reason below says which of those it was.
 */

/** Where a template is written. Behind `SUITE_ADMIN_TOKEN` on the control plane. */
export const TEMPLATE_POST_PATH = "/admin/templates";

/**
 * The control plane's cap on one template body (`MAX_TEMPLATE_BODY_BYTES` in
 * `apps/control-plane/src/modules/admin.ts`), mirrored here so a capture that is
 * too big is refused with a sentence instead of uploading sixteen megabytes to be
 * told the same thing. A change there is a change here.
 */
export const TEMPLATE_BODY_MAX_BYTES = 16 * 1024 * 1024;

/** What the caller can say while a save runs. */
export type TemplateSaveStage = "capturing" | "uploading";

/**
 * Why a save did not happen. Every one of these reads differently on screen, so
 * an operator never has to guess which door they are missing.
 */
export type TemplateSaveFailure =
  /** This build is the browser-only profile: there is no control plane to write to. */
  | "standalone"
  /** No operator token in this tab. */
  | "no-token"
  /** Nothing to call the template. */
  | "no-name"
  /** A save is already running. */
  | "busy"
  /** The document refused the capture; `message` is the graph's own reason. */
  | "cannot-capture"
  /** The serialized template is over the control plane's body cap. */
  | "too-large"
  /** A template already holds this id. */
  | "duplicate"
  /** The request reached the control plane and was refused. */
  | "rejected"
  /** The control plane could not be reached at all. */
  | "unreachable";

export interface TemplateSaved {
  ok: true;
  /** The id it was stored under, derived from the name. */
  id: string;
  name: string;
  /** Pictures carried inline. */
  assets: number;
  /** Pictures the workspace holds that the template could not carry. */
  dropped: number;
  /** Serialized body size: the number the control plane's cap measures. */
  bytes: number;
}

export interface TemplateSaveRefused {
  ok: false;
  reason: TemplateSaveFailure;
  message: string;
}

export type TemplateSaveOutcome = TemplateSaved | TemplateSaveRefused;

export interface SaveTemplateInput {
  /** The open document. Read through the typed layer, never raw Loro. */
  workspace: WorkspaceDocument;
  name: string;
  description?: string;
  /** Defaults to the token this tab holds; `null` means nobody is signed in. */
  token?: string | null;
  /**
   * Where picture bytes come from. Defaults to the order an export uses: this
   * browser's copy first, then the relay, so a picture pasted offline is still
   * carried.
   */
  sources?: readonly AttachmentSource[];
  fetch?: typeof globalThis.fetch;
  /** Base URL for the control plane. Defaults to `accountHttpBase()`. */
  base?: string;
  /** Tests lower it; production reads the control plane's cap. */
  maxBodyBytes?: number;
  onStage?: (stage: TemplateSaveStage) => void;
}

/**
 * A stable id from a name: lowercase, hyphenated, the same id for the same name
 * every time. A second capture under a taken name therefore collides on purpose —
 * the control plane answers 409, and the operator decides whether that is their
 * own duplicate or a name to change.
 */
export function templateIdFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/gu, "");
  return slug.length > 0 ? slug : "captured-template";
}

/** Bytes as the number a person reads, so a refusal can quote a real size. */
function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The server's own words when it gave any, else the status line. */
async function refusalDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.message === "string" && body.message.trim().length > 0) {
      return body.message.trim();
    }
    if (typeof body.error === "string" && body.error.trim().length > 0) return body.error.trim();
  } catch {
    // Not JSON; the status line is all there is to quote.
  }
  return `${response.status} ${response.statusText}`.trim();
}

/** One line a dialog may show for a save that finished. */
export function templateSavedNotice(saved: TemplateSaved): string {
  const pictures =
    saved.assets === 0
      ? ""
      : saved.assets === 1
        ? " with 1 picture"
        : ` with ${saved.assets} pictures`;
  const dropped =
    saved.dropped === 0
      ? ""
      : ` ${saved.dropped} picture${saved.dropped === 1 ? " was" : "s were"} too heavy to carry or could not be read, so ${saved.dropped === 1 ? "it is" : "they are"} missing from the template.`;
  return `“${saved.name}” is saved as a starter template${pictures}. New workspaces can start from it.${dropped}`;
}

/**
 * Guards the one running capture. The dialog disables its own button, but a
 * keyboard repeat or a second surface would otherwise post the same template
 * twice and leave the first answer to land on a closed dialog.
 */
let running = false;

/** Reads the open workspace into a template and stores it. Never throws. */
export async function saveWorkspaceTemplate(
  input: SaveTemplateInput,
): Promise<TemplateSaveOutcome> {
  if (running) {
    return {
      ok: false,
      reason: "busy",
      message: "A starter template is already being saved. Wait for that one to finish.",
    };
  }
  // A standalone build has no control plane, so there is nowhere for a template
  // to go and no reason to read a board's pictures first.
  if (isStandalone()) {
    return {
      ok: false,
      reason: "standalone",
      message:
        "This copy of Suite runs entirely in the browser and has no server, so a starter template has no home. Save one from a hosted or self-hosted build.",
    };
  }
  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, reason: "no-name", message: "A starter template needs a name." };
  }
  // Checked before anything is read: reading every picture to then discover
  // nobody is signed in is the slowest possible way to say "sign in first".
  const token = input.token === undefined ? operatorToken() : input.token;
  if (token === null || token.trim().length === 0) {
    return {
      ok: false,
      reason: "no-token",
      message:
        "Saving a starter template needs the operator token, and this tab holds none. Sign in on the operator panel in this tab, then try again.",
    };
  }

  running = true;
  try {
    return await capture(input, name, token.trim());
  } finally {
    running = false;
  }
}

async function capture(
  input: SaveTemplateInput,
  name: string,
  token: string,
): Promise<TemplateSaveOutcome> {
  const description = (input.description ?? "").trim();
  const sources = input.sources ?? defaultAttachmentSources();
  const dropped = new Set<string>();

  const loadAsset: TemplateAssetLoader = async (attachmentId) => {
    const found = await resolveAttachmentBytes(attachmentId, sources);
    // The same per-picture cap the graph applies on the way out, applied here
    // first so the picture is named in the result instead of vanishing quietly.
    if (found === null || found.bytes.byteLength > TEMPLATE_ASSET_MAX_BYTES) {
      dropped.add(attachmentId);
      return null;
    }
    return { mime: found.mime, bytes: found.bytes };
  };

  input.onStage?.("capturing");
  let template: WorkspaceTemplate;
  try {
    template = await captureWorkspaceTemplate(input.workspace, {
      id: templateIdFromName(name),
      name,
      ...(description.length > 0 ? { description } : {}),
      loadAsset,
    });
  } catch (cause) {
    return {
      ok: false,
      reason: "cannot-capture",
      message:
        cause instanceof Error && cause.message.trim().length > 0
          ? cause.message
          : "This workspace could not be read as a template.",
    };
  }

  // `data` is the template object itself, the shape `applyWorkspaceTemplate`
  // reads and `workspaceTemplateSchema` validates, so whoever lists these rows
  // hands it back without a translation step.
  const body = JSON.stringify({
    id: template.id,
    name: template.name,
    description: template.description,
    version: template.version,
    data: template,
  });
  const bytes = new TextEncoder().encode(body).byteLength;
  const cap = input.maxBodyBytes ?? TEMPLATE_BODY_MAX_BYTES;
  if (bytes > cap) {
    return {
      ok: false,
      reason: "too-large",
      message: `This template weighs ${megabytes(bytes)} and the server takes ${megabytes(cap)}. Save fewer pictures, or smaller ones, and try again.`,
    };
  }

  const base = (input.base ?? accountHttpBase()).replace(/\/+$/u, "");
  const call = input.fetch ?? globalThis.fetch;
  input.onStage?.("uploading");

  let response: Response;
  try {
    response = await call(`${base}${TEMPLATE_POST_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
    });
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: `Could not reach the control plane at ${base}, so nothing was saved.`,
    };
  }

  if (!response.ok) {
    if (response.status === 409) {
      return {
        ok: false,
        reason: "duplicate",
        message: `A starter template with the id “${template.id}” already exists. Rename this one, or replace that one from the operator panel.`,
      };
    }
    const detail = await refusalDetail(response);
    return {
      ok: false,
      reason: "rejected",
      message:
        response.status === 401 || response.status === 403
          ? `The operator token was refused (${response.status}): ${detail}. Sign in again on the operator panel and retry.`
          : `The template was not saved: ${detail}`,
    };
  }

  return {
    ok: true,
    id: template.id,
    name: template.name,
    assets: template.assets?.length ?? 0,
    dropped: dropped.size,
    bytes,
  };
}
