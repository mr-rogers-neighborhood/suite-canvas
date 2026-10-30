import { create } from "zustand";
import { formatEstimate, type PersistState, type StorageEstimate } from "../storage/durability";
import { type BuildInfo, buildInfo } from "./buildInfo";

/**
 * The diagnostic bundle: one file a support ticket can carry, produced without a
 * network round trip from a tab that may be broken.
 *
 * It is assembled from an allowlist, never by filtering a richer object. The
 * allowlist is: build, route, the shape of the configuration, storage state,
 * connection state, document counts, room and store statistics the operator API
 * already returned, the last few uncaught errors, and the request ids this page
 * saw. Every free-form string that came from outside — an error message, a stack
 * frame, a configured URL — passes through `scrubText` on the way in and again on
 * the way out.
 *
 * Deliberately absent, and never to be added: the session JWT, a share token or
 * the fragment it can live in, the licence token, the admin token, card titles
 * and bodies, attachment names and bytes, document snapshots, cookies, and any
 * request or response body. A bundle that could leak a credential is worse than
 * no bundle, so the redaction is a whitelist plus a scrub, not a blacklist.
 */

export interface LastError {
  message: string;
  name: string;
  stack: string | null;
  at: number;
  route: string;
}

/** How many uncaught errors and request ids a bundle carries. */
const MAX_RECORDED_ERRORS = 10;
const MAX_REQUEST_IDS = 10;

/** Query parameters that are credentials or near enough. */
const SECRET_PARAMS = [
  "share",
  "token",
  "key",
  "owner",
  "licence",
  "license",
  "session",
  "code",
  "state",
  "password",
  "secret",
  "sig",
  "signature",
  "access_token",
  "id_token",
] as const;

/**
 * Token-shaped runs, in the order they are removed. A licence key is base64url,
 * a share token is base64url, a session JWT is three base64url segments, and a
 * `Bearer` header is the same thing with a name in front.
 */
const SCRUBBERS: readonly (readonly [RegExp, string])[] = [
  [
    /(^|[\s?&#"'(])((?:share|token|key|owner|licence|license|session|code|state|password|secret|sig|signature|access_token|id_token)=)[^&\s"'<>]+/giu,
    "$1$2redacted",
  ],
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/gu, "[redacted-jwt]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [redacted]"],
  [/\b[A-Za-z0-9_-]{32,}\b/gu, "[redacted-token]"],
];

/**
 * Removes credentials from a string that came from outside. Over-redaction is
 * the intended failure: a stack frame whose hash vanished is still a stack
 * frame, and a token that survived is a breach.
 */
export function scrubText(value: string): string {
  return SCRUBBERS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

interface DiagnosticsState {
  /** The newest error, which is what the fallback shows. */
  lastError: LastError | null;
  /** Newest first, bounded. */
  errors: LastError[];
  /** `x-request-id` values seen on this page, newest first, bounded. */
  requestIds: string[];
  record: (error: LastError) => void;
  noteRequestId: (id: string) => void;
  clear: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  lastError: null,
  errors: [],
  requestIds: [],
  record: (error) =>
    set((state) => ({
      lastError: error,
      errors: [error, ...state.errors].slice(0, MAX_RECORDED_ERRORS),
    })),
  noteRequestId: (id) =>
    set((state) => ({
      requestIds: [id, ...state.requestIds.filter((seen) => seen !== id)].slice(0, MAX_REQUEST_IDS),
    })),
  clear: () => set({ lastError: null, errors: [], requestIds: [] }),
}));

/** Turns a thrown value into the record the boundary and the bundle both use. */
export function describeError(error: unknown, route: string): LastError {
  const asError = error instanceof Error ? error : null;
  return {
    name: asError?.name ?? "Error",
    // Scrubbed at the source: an error thrown by a fetch wrapper can carry the
    // URL, and a URL can carry a share token.
    message: scrubText(asError?.message ?? String(error)),
    stack: asError?.stack === undefined ? null : scrubText(asError.stack),
    at: Date.now(),
    route: safeRoute(route),
  };
}

const SECRET_PARAM_VALUES = new RegExp(`([?&](?:${SECRET_PARAMS.join("|")})=)[^&#]*`, "giu");

/**
 * The URL with its secret parts removed: the owner key lived in the fragment, a
 * share token is a credential in its own right, and a session code arrives in the
 * query during a sign-in redirect.
 *
 * Accepts an absolute URL or a path, because a caller that has already sanitised
 * a route hands it back here and must not end up with `(unreadable route)`.
 */
export function safeRoute(href: string): string {
  const withoutHash = href.split("#")[0] ?? "";
  let route = withoutHash;
  try {
    const url = new URL(withoutHash);
    route = `${url.pathname}${url.search}`;
  } catch {
    if (!withoutHash.startsWith("/")) return "(unreadable route)";
  }
  return route.replace(SECRET_PARAM_VALUES, "$1redacted");
}

/** An origin and nothing else: a relay URL is configured, and a query is not ours. */
function originOnly(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

/** A short, scrubbed label. Long input is a mistake, not a field. */
function shortLabel(value: string | undefined, max: number): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return scrubText(trimmed).slice(0, max);
}

/**
 * The configuration a bundle is allowed to name. Everything here is either a
 * boolean, an origin, or a scrubbed short label; a value that cannot be
 * recognised becomes `null` rather than being echoed.
 */
export interface DiagnosticConfig {
  relay: string | null;
  surface: string | null;
  session: string | null;
  hosted: boolean | null;
  licence: boolean | null;
  admin: boolean | null;
  online: boolean | null;
  viewport: string | null;
  userAgent: string | null;
  language: string | null;
}

export interface DiagnosticConfigInput {
  relay?: string | undefined;
  surface?: string | undefined;
  session?: string | undefined;
  hosted?: boolean | null | undefined;
  licence?: boolean | null | undefined;
  admin?: boolean | null | undefined;
  online?: boolean | null | undefined;
  viewport?: string | undefined;
  userAgent?: string | undefined;
  language?: string | undefined;
}

export function redactConfig(input: DiagnosticConfigInput = {}): DiagnosticConfig {
  return {
    relay: originOnly(input.relay),
    surface: shortLabel(input.surface, 24),
    session: shortLabel(input.session, 24),
    hosted: input.hosted ?? null,
    licence: input.licence ?? null,
    admin: input.admin ?? null,
    online: input.online ?? null,
    viewport: shortLabel(input.viewport, 20),
    userAgent: shortLabel(input.userAgent, 160),
    language: shortLabel(input.language, 24),
  };
}

/** Counts only. No title, body, id or byte of content. */
export interface DocumentStats {
  boards: number;
  cards: number;
  sections: number;
  /** `null` when the caller has no size for it. */
  bytes: number | null;
}

/**
 * What the relay and the control plane answered when this page asked. Values are
 * numbers and enum labels; `buildId` and module names come from the services'
 * own `/health`, and the store paths are reduced to a file name by the caller.
 */
export interface ServerStats {
  relayHealth: "ok" | "unreachable" | "unknown";
  controlPlane: {
    status: string;
    buildId: string;
    uptimeMs: number;
    modules: { name: string; state: string }[];
  } | null;
  rooms: { total: number; clients: number; workers: number } | null;
  stores: { name: string; bytes: number; ok: boolean }[] | null;
  limits: Record<string, number> | null;
}

export interface DiagnosticInput {
  route: string;
  storage: {
    persist: PersistState;
    estimate: StorageEstimate;
    quota: { message: string } | null;
  };
  connection: string;
  /**
   * The newest error, when a caller has one in hand rather than in the store.
   * The fallback and the storage panel both pass the error they are rendering.
   */
  lastError?: LastError | null;
  build?: BuildInfo;
  now?: Date;
  config?: DiagnosticConfigInput;
  document?: DocumentStats | null;
  server?: ServerStats | null;
  /** Defaults to the recorded ring buffer. */
  errors?: readonly LastError[];
  requestIds?: readonly string[];
}

export interface DiagnosticBundle {
  format: "suite.diagnostics/1";
  capturedAt: string;
  build: { version: string; mode: string; production: boolean };
  route: string;
  config: DiagnosticConfig;
  storage: {
    persist: PersistState;
    usage: number | null;
    quota: number | null;
    usageLabel: string;
    quotaFailure: string | null;
  };
  connection: string;
  document: DocumentStats | null;
  server: ServerStats | null;
  errors: { name: string; message: string; stack: string[]; at: string; route: string }[];
  requestIds: string[];
}

/** Bounds a recorded error to what a ticket can use. */
function bundleError(error: LastError): DiagnosticBundle["errors"][number] {
  const stack = (error.stack ?? "")
    .split("\n")
    .slice(0, 12)
    .map((frame) => scrubText(frame.trim()));
  return {
    name: shortLabel(error.name, 64) ?? "Error",
    message: scrubText(error.message).slice(0, 2_000),
    stack,
    at: new Date(error.at).toISOString(),
    route: safeRoute(error.route),
  };
}

/**
 * The structured bundle. Everything a caller passed in is copied through the
 * allowlist above, so a new field cannot leak by being added to an input object.
 */
export function buildDiagnosticBundle(input: DiagnosticInput): DiagnosticBundle {
  const build = input.build ?? buildInfo();
  const now = input.now ?? new Date();
  const recorded = input.errors ?? useDiagnosticsStore.getState().errors;
  // `lastError` is the explicit field a caller may pass instead of the ring
  // buffer, which is what a unit test and a fresh page both do.
  const errors = recorded.length === 0 && input.lastError ? [input.lastError] : recorded;
  const requestIds = input.requestIds ?? useDiagnosticsStore.getState().requestIds;
  return {
    format: "suite.diagnostics/1",
    capturedAt: now.toISOString(),
    build: { version: build.version, mode: build.mode, production: build.production },
    route: safeRoute(input.route),
    config: redactConfig(input.config),
    storage: {
      persist: input.storage.persist,
      usage: input.storage.estimate.usage,
      quota: input.storage.estimate.quota,
      usageLabel: formatEstimate(input.storage.estimate),
      quotaFailure:
        input.storage.quota === null ? null : scrubText(input.storage.quota.message).slice(0, 500),
    },
    connection: shortLabel(input.connection, 120) ?? "unknown",
    document: input.document ?? null,
    server: input.server ?? null,
    errors: errors.slice(0, MAX_RECORDED_ERRORS).map(bundleError),
    requestIds: requestIds.slice(0, MAX_REQUEST_IDS).map((id) => scrubText(id).slice(0, 64)),
  };
}

function textLines(bundle: DiagnosticBundle): string[] {
  const lines = [
    "Suite diagnostics",
    `format: ${bundle.format}`,
    `build: ${bundle.build.version} (${bundle.build.mode})`,
    `route: ${bundle.route}`,
    `captured: ${bundle.capturedAt}`,
    `connection: ${bundle.connection}`,
  ];
  const config = Object.entries(bundle.config)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}=${String(value)}`);
  lines.push(`config: ${config.length === 0 ? "none recorded" : config.join(" ")}`);
  lines.push(`storage: persist=${bundle.storage.persist} usage=${bundle.storage.usageLabel}`);
  if (bundle.storage.quotaFailure !== null) lines.push(`quota: ${bundle.storage.quotaFailure}`);
  if (bundle.document) {
    const size = bundle.document.bytes === null ? "unknown" : `${bundle.document.bytes} bytes`;
    lines.push(
      `document: boards=${bundle.document.boards} cards=${bundle.document.cards} sections=${bundle.document.sections} ${size}`,
    );
  }
  const server = bundle.server;
  if (server) {
    lines.push(`relay health: ${server.relayHealth}`);
    if (server.controlPlane) {
      lines.push(
        `control plane: ${server.controlPlane.status} build=${server.controlPlane.buildId} uptimeMs=${server.controlPlane.uptimeMs} modules=${server.controlPlane.modules
          .map((module) => `${module.name}:${module.state}`)
          .join(",")}`,
      );
    }
    if (server.rooms) {
      lines.push(
        `rooms: open=${server.rooms.total} workers=${server.rooms.workers} clients=${server.rooms.clients}`,
      );
    }
    if (server.stores) {
      lines.push(
        `stores: ${server.stores.map((store) => `${store.name}=${store.bytes}${store.ok ? "" : "(missing)"}`).join(" ")}`,
      );
    }
    if (server.limits) {
      lines.push(
        `limits: ${Object.entries(server.limits)
          .map(([name, value]) => `${name}=${value}`)
          .join(" ")}`,
      );
    }
  }
  lines.push(
    `request ids: ${bundle.requestIds.length === 0 ? "none seen" : bundle.requestIds.join(", ")}`,
  );
  const [newest, ...earlier] = bundle.errors;
  if (newest === undefined) {
    lines.push("last error: none recorded");
    return lines;
  }
  // The newest error keeps the format the fallback has always printed; the ones
  // before it are one line each, so a ticket shows a sequence without a wall of
  // repeated stack frames.
  lines.push(`last error: ${newest.name}: ${newest.message} (${newest.route})`);
  for (const frame of newest.stack) lines.push(`  ${frame}`);
  if (earlier.length > 0) {
    lines.push(`earlier errors: ${earlier.length}`);
    for (const error of earlier) {
      lines.push(`  ${error.at} ${error.name}: ${error.message} (${error.route})`);
    }
  }
  return lines;
}

/** The block the fallback and the support panel copy to the clipboard. */
export function buildDiagnostics(input: DiagnosticInput): string {
  return textLines(buildDiagnosticBundle(input)).join("\n");
}

/** `suite-diagnostics-0.2.0-production-2026-01-01T00-00-00-000Z.json`. */
export function diagnosticsFileName(bundle: DiagnosticBundle): string {
  const version = bundle.build.version.replace(/[^A-Za-z0-9._-]+/gu, "-");
  const stamp = bundle.capturedAt.replace(/[:.]/gu, "-");
  return `suite-diagnostics-${version}-${stamp}.json`;
}

/**
 * Writes an already-built bundle to a file the person can attach to a ticket.
 * Offline, local, and no upload: the report contains no credential, but it is
 * still the user's data and they decide where it goes.
 */
export function saveDiagnosticBundle(bundle: DiagnosticBundle): string {
  const name = diagnosticsFileName(bundle);
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return name;
}

/** Builds the bundle from an input and saves it. */
export function downloadDiagnostics(input: DiagnosticInput): string {
  return saveDiagnosticBundle(buildDiagnosticBundle(input));
}

/**
 * Copies text without a network round trip. The Clipboard API is unavailable
 * outside a secure context and in some embedded browsers, so a hidden textarea
 * and `execCommand` remain the fallback rather than failing the copy.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection-based copy.
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/** The header the relay puts on every response beside its log line. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Records `x-request-id` from every response this page receives, without
 * changing a request or a response. A ticket that names a request id can be
 * joined to the server's `http.request` line; without this the id only exists in
 * the server's log and is unusable from the browser.
 */
export function installRequestIdRecorder(target: Window = window): () => void {
  const original = target.fetch;
  if (typeof original !== "function") return () => undefined;
  const wrapped: typeof fetch = async (input, init) => {
    const response = await original(input, init);
    try {
      const id = response.headers.get(REQUEST_ID_HEADER);
      if (id !== null && id.trim().length > 0) {
        useDiagnosticsStore.getState().noteRequestId(id.trim());
      }
    } catch {
      // An opaque response has no readable headers; that is not an error.
    }
    return response;
  };
  target.fetch = wrapped;
  return () => {
    if (target.fetch === wrapped) target.fetch = original;
  };
}

/** Keeps the last uncaught errors and request ids available to the bundle. */
export function installErrorRecorder(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    const raw = event.message || (event.error instanceof Error ? event.error.message : "");
    if (
      raw.includes("ResizeObserver loop completed with undelivered notifications") ||
      raw.includes("ResizeObserver loop limit exceeded")
    ) {
      return;
    }
    useDiagnosticsStore
      .getState()
      .record(describeError(event.error ?? event.message, safeRoute(target.location.href)));
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const raw =
      event.reason instanceof Error
        ? event.reason.message
        : typeof event.reason === "string"
          ? event.reason
          : "";
    if (
      raw.includes("ResizeObserver loop completed with undelivered notifications") ||
      raw.includes("ResizeObserver loop limit exceeded")
    ) {
      return;
    }
    useDiagnosticsStore
      .getState()
      .record(describeError(event.reason, safeRoute(target.location.href)));
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  const stopRequestIds = installRequestIdRecorder(target);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    stopRequestIds();
  };
}
