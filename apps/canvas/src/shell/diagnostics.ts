import { create } from "zustand";
import { formatEstimate, type PersistState, type StorageEstimate } from "../storage/durability";
import { type BuildInfo, buildInfo } from "./buildInfo";

/**
 * A diagnostic bundle a person can copy off a broken tab with no network at all:
 * build, route, storage state, connection state and the last error. The route is
 * the only field that could carry a secret, so it is sanitised here rather than
 * at each call site.
 */

export interface LastError {
  message: string;
  name: string;
  stack: string | null;
  at: number;
  route: string;
}

interface DiagnosticsState {
  lastError: LastError | null;
  record: (error: LastError) => void;
  clear: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  lastError: null,
  record: (lastError) => set({ lastError }),
  clear: () => set({ lastError: null }),
}));

/** Turns a thrown value into the record the boundary and the bundle both use. */
export function describeError(error: unknown, route: string): LastError {
  const asError = error instanceof Error ? error : null;
  return {
    name: asError?.name ?? "Error",
    message: asError?.message ?? String(error),
    stack: asError?.stack ?? null,
    at: Date.now(),
    route,
  };
}

/**
 * The URL with its secret parts removed: the owner key lives in the fragment,
 * and a share token is a credential in its own right.
 */
export function safeRoute(href: string): string {
  try {
    const url = new URL(href);
    url.hash = "";
    if (url.searchParams.has("share")) url.searchParams.set("share", "redacted");
    return `${url.pathname}${url.search}`;
  } catch {
    return "(unreadable route)";
  }
}

export interface DiagnosticInput {
  route: string;
  storage: {
    persist: PersistState;
    estimate: StorageEstimate;
    quota: { message: string } | null;
  };
  connection: string;
  lastError: LastError | null;
  build?: BuildInfo;
  now?: Date;
}

/** The block the fallback and the storage panel copy to the clipboard. */
export function buildDiagnostics(input: DiagnosticInput): string {
  const build = input.build ?? buildInfo();
  const lines = [
    "Suite diagnostics",
    `build: ${build.version} (${build.mode})`,
    `route: ${safeRoute(input.route)}`,
    `storage: persist=${input.storage.persist} usage=${formatEstimate(input.storage.estimate)}`,
    `connection: ${input.connection}`,
    `captured: ${(input.now ?? new Date()).toISOString()}`,
  ];
  if (input.storage.quota) lines.push(`quota: ${input.storage.quota.message}`);
  if (input.lastError) {
    lines.push(`last error: ${input.lastError.name}: ${input.lastError.message}`);
    if (input.lastError.stack) {
      lines.push(
        ...input.lastError.stack
          .split("\n")
          .slice(0, 12)
          .map((frame) => `  ${frame.trim()}`),
      );
    }
  } else {
    lines.push("last error: none recorded");
  }
  return lines.join("\n");
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

/** Keeps the last uncaught error available to the diagnostics bundle. */
export function installErrorRecorder(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    useDiagnosticsStore
      .getState()
      .record(describeError(event.error ?? event.message, safeRoute(target.location.href)));
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    useDiagnosticsStore
      .getState()
      .record(describeError(event.reason, safeRoute(target.location.href)));
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
