/**
 * Crash-report scrubbing.
 *
 * The reporter sends an allowlist, not a filtered copy of the SDK's event: build
 * version, route, browser/OS, stack frames and a hashed workspace id. Nothing
 * else on the event can reach the wire — not card titles, card bodies,
 * attachment names, document bytes, share tokens or the owner key.
 *
 * The hash exists so two crashes from one workspace can be counted together. It
 * is never sent beside the owner key: if the key appears anywhere in the
 * payload, the whole event is dropped rather than redacted, because an event
 * that crossed that line is not worth the risk of a partial removal.
 */

export interface ScrubContext {
  buildVersion: string;
  mode: string;
  /** The route with secrets already removed (`safeRoute`). */
  route: string;
  /** SHA-256 of the workspace id, or null when hashing is unavailable. */
  workspaceHash: string | null;
  /** The live owner key, used only to prove it is absent. */
  ownerKey?: string | null;
}

interface LooseEvent {
  event_id?: unknown;
  timestamp?: unknown;
  level?: unknown;
  exception?: { values?: unknown };
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

interface StackFrame {
  filename?: unknown;
  function?: unknown;
  lineno?: unknown;
  colno?: unknown;
  in_app?: unknown;
}

const BROWSER_CONTEXT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/** Browser and OS, from the event's own contexts when it has them, else the UA. */
export function describePlatform(
  contexts: Record<string, unknown> | undefined,
  userAgent: string | undefined,
): { browser: { name: string; version?: string }; os: { name: string } } {
  const browser = contexts?.browser as { name?: unknown; version?: unknown } | undefined;
  const os = contexts?.os as { name?: unknown } | undefined;
  const ua =
    userAgent ?? (typeof navigator === "undefined" ? undefined : navigator.userAgent) ?? "";
  const browserName =
    (typeof browser?.name === "string" && browser.name) || guessBrowser(ua) || "unknown";
  const osName = (typeof os?.name === "string" && os.name) || guessOs(ua) || "unknown";
  return {
    browser: {
      name: browserName,
      ...(typeof browser?.version === "string" ? { version: browser.version } : {}),
    },
    os: { name: osName },
  };
}

function guessBrowser(ua: string): string | null {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return null;
}

function guessOs(ua: string): string | null {
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function scrubFrames(stacktrace: unknown): StackFrame[] {
  const frames = (stacktrace as { frames?: unknown })?.frames;
  if (!Array.isArray(frames)) return [];
  return frames.slice(0, 40).map((frame) => {
    const entry = (frame ?? {}) as StackFrame;
    return {
      ...(typeof entry.filename === "string" ? { filename: entry.filename } : {}),
      ...(typeof entry.function === "string" ? { function: entry.function } : {}),
      ...(typeof entry.lineno === "number" ? { lineno: entry.lineno } : {}),
      ...(typeof entry.colno === "number" ? { colno: entry.colno } : {}),
      ...(typeof entry.in_app === "boolean" ? { in_app: entry.in_app } : {}),
    } satisfies StackFrame;
  });
}

/** Only the exception type and its frames survive; a message is free text. */
function scrubException(exception: unknown): { values: unknown[] } {
  const values = (exception as { values?: unknown })?.values;
  if (!Array.isArray(values) || values.length === 0) return { values: [] };
  return {
    values: [
      {
        type: String((values[0] as { type?: unknown })?.type ?? "Error"),
        stacktrace: { frames: scrubFrames((values[0] as { stacktrace?: unknown })?.stacktrace) },
      },
    ],
  };
}

/**
 * The payload an opted-in crash report carries, or `null` when the event must be
 * dropped (it mentioned the owner key, or it carried nothing reportable).
 */
export function scrubEvent(event: unknown, context: ScrubContext): Record<string, unknown> | null {
  if (!event || typeof event !== "object") return null;
  const loose = event as LooseEvent;
  const platform = describePlatform(loose.contexts, BROWSER_CONTEXT);

  const payload: Record<string, unknown> = {
    platform: "javascript",
    release: context.buildVersion,
    environment: context.mode,
    transaction: context.route,
    tags: { build: context.buildVersion, route: context.route },
    contexts: { browser: platform.browser, os: platform.os },
    exception: scrubException(loose.exception),
    // The hash is scoped to one field so it cannot be mistaken for an identity.
    workspace: { id_hash: context.workspaceHash },
  };
  if (typeof loose.event_id === "string") payload.event_id = loose.event_id;
  if (typeof loose.timestamp === "number") payload.timestamp = loose.timestamp;
  if (typeof loose.level === "string") payload.level = loose.level;

  if (context.workspaceHash === null) delete payload.workspace;
  return leaksCredential(payload, context.ownerKey) ? null : payload;
}

/** True when the payload mentions the owner key anywhere, at any depth. */
export function leaksCredential(payload: unknown, ownerKey: string | null | undefined): boolean {
  if (!ownerKey || ownerKey.length < 8) return false;
  const serialized = safeSerialize(payload);
  return serialized.includes(ownerKey);
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * SHA-256 of the workspace id, hex and truncated. Two crashes from one workspace
 * group; the id itself, which is a room name in the relay, never travels.
 */
export async function hashWorkspaceId(workspaceId: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || workspaceId.length === 0) return null;
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(workspaceId));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    return null;
  }
}
