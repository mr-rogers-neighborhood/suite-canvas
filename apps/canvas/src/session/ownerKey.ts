/**
 * The workspace owner key is a bearer capability kept by the browser, not by the
 * server: the relay stores only its SHA-256 hash. It travels in the editor URL
 * fragment so it is never sent in a request or a referrer.
 */

import { collabHttpBase } from "./endpoints";

export const OWNER_KEY_PREFIX = "suite.owner.";
/** Remembers how far this device got with the claim, never the relay's view. */
export const CLAIM_RECORD_PREFIX = "suite.owner-claim.";
export const WORKSPACE_API_PATH = "/api/workspaces";
/** The claim call must never delay a local-first boot for long. */
export const CLAIM_TIMEOUT_MS = 2500;
/**
 * Backoff for a claim that could not reach the relay. It caps at a minute:
 * a pending claim is retried for as long as the tab lives, and again on the
 * next boot, so every retry has to stay cheap.
 */
export const CLAIM_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

const OWNER_KEY_BYTES = 32;

/**
 * What a claim attempt settled on.
 *
 * `pending` and `offline` are the same decision — keep the key, keep the
 * document, retry — but they answer different questions. `offline` means the
 * browser knew it had no network and never asked; `pending` means it asked and
 * got no usable answer (rejected fetch, timeout, 5xx, rate limit). Neither is a
 * conflict, and neither may ever be reported as `claimed`.
 */
export type ClaimOutcome = "claimed" | "pending" | "conflict" | "offline";

/** @deprecated A claim status is one of the four `ClaimOutcome` values. */
export type ClaimStatus = ClaimOutcome;

/** What one attempt produced, with no I/O attached: the input to `claimOutcome`. */
export type ClaimSignal =
  | { kind: "response"; status: number }
  | { kind: "network-error" }
  | { kind: "timeout" }
  | { kind: "no-network" };

/** Claim machine states; `claiming` is the only in-flight one. */
export type ClaimState = "unclaimed" | "claiming" | ClaimOutcome;

export type ClaimEvent =
  | { type: "attempt" }
  | { type: "outcome"; outcome: ClaimOutcome }
  | { type: "online" }
  | { type: "retry" };

/**
 * Last claim this device remembers for a workspace. It is what tells the two
 * `conflict` shapes apart: `pending` means the workspace was edited here before
 * anyone owned it, `claimed` means this browser used to own it.
 */
export type ClaimRecord = "claimed" | "pending";

export interface OwnerSession {
  ownerKey: string;
  claim: ClaimOutcome;
  /** True while a pending claim is watching for a reconnect. */
  retrying: boolean;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/** The base64url form used by stored, shared and passphrase-derived keys. */
export function ownerKeyFromBytes(bytes: Uint8Array): string {
  return encodeBase64Url(bytes);
}

/** 32 random bytes as base64url; the server only ever sees the hash. */
export function generateOwnerKey(): string {
  const bytes = new Uint8Array(OWNER_KEY_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function readOwnerKey(workspaceId: string): string | null {
  if (!hasStorage() || workspaceId.trim().length === 0) return null;
  try {
    const stored = window.localStorage.getItem(`${OWNER_KEY_PREFIX}${workspaceId}`);
    return stored !== null && stored.trim().length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function writeOwnerKey(workspaceId: string, ownerKey: string): void {
  if (!hasStorage() || workspaceId.trim().length === 0 || ownerKey.trim().length === 0) return;
  try {
    window.localStorage.setItem(`${OWNER_KEY_PREFIX}${workspaceId}`, ownerKey);
  } catch {
    // A full or disabled localStorage must not block opening a workspace.
  }
}

/**
 * Drops the key this browser holds. The relay still has the workspace and its
 * hashed key, so a recovery file or owner link can reclaim access later.
 */
export function forgetOwnerKey(workspaceId: string): void {
  if (!hasStorage() || workspaceId.trim().length === 0) return;
  try {
    window.localStorage.removeItem(`${OWNER_KEY_PREFIX}${workspaceId}`);
    window.localStorage.removeItem(`${CLAIM_RECORD_PREFIX}${workspaceId}`);
  } catch {
    // Ignore: a browser that cannot write cannot hold a key either.
  }
}

/** How far the last open of this workspace got, as far as this device knows. */
export function readClaimRecord(workspaceId: string): ClaimRecord | null {
  if (!hasStorage() || workspaceId.trim().length === 0) return null;
  try {
    const stored = window.localStorage.getItem(`${CLAIM_RECORD_PREFIX}${workspaceId}`);
    return stored === "claimed" || stored === "pending" ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Records the outcome for the next boot's copy. A conflict deliberately leaves
 * the previous record in place: it is the record that says whether this device
 * had a local copy before the workspace was taken by someone else.
 */
export function recordClaimOutcome(workspaceId: string, outcome: ClaimOutcome): void {
  if (!hasStorage() || workspaceId.trim().length === 0) return;
  const record: ClaimRecord | null =
    outcome === "claimed" ? "claimed" : outcome === "conflict" ? null : "pending";
  if (record === null) return;
  try {
    window.localStorage.setItem(`${CLAIM_RECORD_PREFIX}${workspaceId}`, record);
  } catch {
    // A browser without storage still works; it just loses the copy nuance.
  }
}

/** The owner key in a `#owner=<key>` fragment, if the page has one. */
export function ownerKeyFromFragment(hash?: string): string | null {
  const source = hash ?? (typeof window === "undefined" ? "" : window.location.hash);
  const fragment = source.startsWith("#") ? source.slice(1) : source;
  if (fragment.length === 0) return null;
  const key = new URLSearchParams(fragment).get("owner");
  return key !== null && key.trim().length > 0 ? key : null;
}

/** Replaces the hash with the owner fragment, keeping the query intact. */
export function withOwnerFragment(url: string, ownerKey: string): string {
  const base = typeof window === "undefined" ? "http://localhost" : window.location.href;
  const next = new URL(url, base);
  next.hash = `owner=${encodeURIComponent(ownerKey)}`;
  return next.toString();
}

/**
 * Rewrites the fragment and boots the app again. A fragment-only `assign` would
 * not reload, so the in-memory session would keep the old key; the reload is
 * what makes a freshly imported or rotated key the one the app uses.
 */
export function reloadWithOwnerKey(ownerKey: string): void {
  window.history.replaceState(null, "", withOwnerFragment(window.location.href, ownerKey));
  window.location.reload();
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(CLAIM_TIMEOUT_MS)
    : undefined;
}

/** A browser that already knows it is offline should not spend the timeout. */
function hasNetwork(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * The claim state machine. Pure on purpose: the decision that matters is which
 * of the four outcomes an attempt produced, and that must be testable without a
 * browser, a socket or a clock.
 *
 * `claimed` and `conflict` are terminal — the first is ownership, the second is
 * the absence of it. `pending` and `offline` are retryable; a reconnect or the
 * backoff timer moves them back to `claiming`.
 */
export function claimOutcome(signal: ClaimSignal): ClaimOutcome {
  switch (signal.kind) {
    case "no-network":
      return "offline";
    case "network-error":
    case "timeout":
      return "pending";
    case "response": {
      const { status } = signal;
      if (status >= 200 && status < 300) return "claimed";
      // 409 is the relay's only "someone else owns this" answer: the key on
      // this device is not the one the workspace accepts.
      if (status === 409) return "conflict";
      // Retry these: the relay is busy, throttling or briefly broken. None of
      // them says anything about who owns the workspace.
      if (status === 408 || status === 425 || status === 429 || status >= 500) return "pending";
      // Any other refusal is definitive for this key (400 malformed, 401/403
      // not the owner, 404 no such route): do not keep retrying it.
      if (status >= 400) return "conflict";
      // 1xx/3xx/0: not an answer the claim understands, so try again.
      return "pending";
    }
  }
}

export function nextClaimState(state: ClaimState, event: ClaimEvent): ClaimState {
  if (state === "claimed" || state === "conflict") return state;
  switch (event.type) {
    case "attempt":
      return "claiming";
    case "outcome":
      return event.outcome;
    case "online":
    case "retry":
      // Only a failed attempt is worth another one; an in-flight claim owns the
      // socket and a fresh boot stays `unclaimed` until it tries.
      return state === "pending" || state === "offline" ? "claiming" : state;
  }
}

/** Terminal: no retry will change this state. */
export function isClaimSettled(state: ClaimState): boolean {
  return state === "claimed" || state === "conflict";
}

/** Pending or offline: keep the key and the document, try again later. */
export function isClaimRetryable(state: ClaimState): boolean {
  return state === "pending" || state === "offline";
}

/**
 * The only state in which the relay will accept a write from this key. The
 * server enforces it too (a join verifies and never claims), so an unclaimed
 * key cannot write even if a caller forgets to ask.
 */
export function mayWriteWorkspace(state: ClaimState): boolean {
  return state === "claimed";
}

/**
 * The part of the sync provider a claim cares about. Typed here so the claim
 * machine does not depend on the transport: the provider is passed in by the
 * caller that resolves it lazily.
 */
export interface RejoinableDocument {
  rejoin: () => Promise<void>;
}

/**
 * The one bridge from the claim machine to the sync room, called with every
 * outcome the retry loop produces while the page is open.
 *
 * - `claimed` — rejoin once. This is the only outcome that makes a room the
 *   relay refused at boot joinable.
 * - `conflict` (the 409) — never rejoin and never write: another key owns the
 *   workspace, so the local document stays local and the protected screen is
 *   the only way back in.
 * - `pending` / `offline` — no rejoin yet; the retry loop owns the next move.
 *
 * Returns whether a rejoin was requested, which is what a test can assert for
 * the 409 path without opening a socket.
 */
export function rejoinOnClaim(outcome: ClaimOutcome, document: RejoinableDocument | null): boolean {
  if (document === null || !mayWriteWorkspace(outcome)) return false;
  void document.rejoin();
  return true;
}

async function requestClaim(workspaceId: string, ownerKey: string): Promise<ClaimSignal> {
  const url = `${collabHttpBase()}${WORKSPACE_API_PATH}/${encodeURIComponent(workspaceId)}/claim`;
  try {
    const signal = timeoutSignal();
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerKey }),
      ...(signal ? { signal } : {}),
    });
    return { kind: "response", status: response.status };
  } catch (error) {
    return isTimeout(error) ? { kind: "timeout" } : { kind: "network-error" };
  }
}

/**
 * Registers this key with the relay. A network failure is not a conflict: the
 * workspace keeps working locally, the key stays, and the claim is retried on a
 * reconnect and on the next boot. Claiming twice with the same key succeeds
 * (the relay compares hashes), so every retry is safe.
 */
export async function claimWorkspace(workspaceId: string, ownerKey: string): Promise<ClaimOutcome> {
  if (!hasNetwork()) return claimOutcome({ kind: "no-network" });
  return claimOutcome(await requestClaim(workspaceId, ownerKey));
}

export interface ClaimRetryOptions {
  /** Attempt schedule; the last delay repeats. Defaults to `CLAIM_RETRY_DELAYS_MS`. */
  delays?: readonly number[];
  /** Called with the outcome of every attempt, including the one that settles. */
  onOutcome?: (outcome: ClaimOutcome) => void;
}

/** One retry loop per workspace: a second boot replaces the first, never stacks. */
const claimRetries = new Map<string, () => void>();

function retryDelay(delays: readonly number[], attempt: number): number {
  if (delays.length === 0) return CLAIM_RETRY_DELAYS_MS[CLAIM_RETRY_DELAYS_MS.length - 1] ?? 60_000;
  const index = Math.min(Math.max(attempt, 0), delays.length - 1);
  return delays[index] ?? 60_000;
}

/**
 * Retries a pending claim until it settles. The loop watches `online` for an
 * immediate attempt (a reconnect is the cheapest moment to ask) and otherwise
 * follows a capped backoff. It stops on `claimed` or `conflict`, and the
 * returned function stops it early — a later boot starts its own.
 */
export function startClaimRetry(
  workspaceId: string,
  ownerKey: string,
  options: ClaimRetryOptions = {},
): () => void {
  if (workspaceId.trim().length === 0 || ownerKey.trim().length === 0) return () => {};
  stopClaimRetry(workspaceId);

  const delays = options.delays ?? CLAIM_RETRY_DELAYS_MS;
  let stopped = false;
  let inFlight = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
    if (claimRetries.get(workspaceId) === stop) claimRetries.delete(workspaceId);
  }

  function schedule() {
    if (stopped) return;
    const delay = retryDelay(delays, attempts);
    attempts += 1;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  }

  async function run() {
    if (stopped || inFlight) return;
    inFlight = true;
    let outcome: ClaimOutcome = "pending";
    try {
      outcome = await claimWorkspace(workspaceId, ownerKey);
    } catch {
      // A claim must never throw at the caller: an unexpected failure is still
      // just "not claimed yet".
      outcome = "pending";
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    recordClaimOutcome(workspaceId, outcome);
    options.onOutcome?.(outcome);
    if (isClaimSettled(outcome)) {
      stop();
      return;
    }
    schedule();
  }

  function onOnline() {
    if (stopped) return;
    // A reconnect earns a fresh, short schedule rather than the current step.
    attempts = 0;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    void run();
  }

  if (typeof window !== "undefined") window.addEventListener("online", onOnline);
  claimRetries.set(workspaceId, stop);
  // The caller starts the loop right after a failed attempt, so the first
  // retry is the first step of the backoff.
  schedule();
  return stop;
}

export function stopClaimRetry(workspaceId: string): void {
  claimRetries.get(workspaceId)?.();
}

/** Tests and teardown; the app never needs this. */
export function stopAllClaimRetries(): void {
  for (const stop of [...claimRetries.values()]) stop();
}

export interface PrepareOwnerSessionOptions {
  /** Start the reconnect loop for a pending claim. Defaults to true in a browser. */
  retry?: boolean;
  retryDelays?: readonly number[];
  onOutcome?: (outcome: ClaimOutcome) => void;
}

/**
 * Picks the key this tab should use: an explicit fragment key wins over a stored
 * one, and neither existing key is discarded when the claim conflicts.
 *
 * A claim that could not be made leaves the session `pending` or `offline`: the
 * key and the local document stay, the editor keeps working locally, and the
 * retry loop (plus the next boot) finishes the claim when the relay is back.
 */
export async function prepareOwnerSession(
  workspaceId: string,
  options: PrepareOwnerSessionOptions = {},
): Promise<OwnerSession> {
  const fromFragment = ownerKeyFromFragment();
  let ownerKey = fromFragment ?? readOwnerKey(workspaceId);
  if (!ownerKey) {
    ownerKey = generateOwnerKey();
    writeOwnerKey(workspaceId, ownerKey);
  }
  const claim = await claimWorkspace(workspaceId, ownerKey);
  recordClaimOutcome(workspaceId, claim);
  // An editor link opened on a fresh browser should keep working without the
  // fragment next time, but a conflicting key must not replace a stored one.
  if (fromFragment && claim !== "conflict") writeOwnerKey(workspaceId, ownerKey);

  const retrying = isClaimRetryable(claim) && typeof window !== "undefined";
  if (retrying && options.retry !== false) {
    startClaimRetry(workspaceId, ownerKey, {
      ...(options.retryDelays ? { delays: options.retryDelays } : {}),
      ...(options.onOutcome ? { onOutcome: options.onOutcome } : {}),
    });
  }
  return { ownerKey, claim, retrying };
}

function serverMessage(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>).error;
  return typeof value === "string" ? value.trim() : "";
}

function rotateError(status: number, body: unknown): string {
  const message = serverMessage(body);
  if (message.length > 0) return message;
  if (status === 401) return "The server did not receive the current owner key.";
  if (status === 403) return "This browser no longer holds the current owner key.";
  if (status === 400) return "The new owner key was refused.";
  return `The owner key could not be replaced (${status}).`;
}

/**
 * Replaces the owner key on the relay. The current key travels in the
 * Authorization header, so it never appears in the URL or the request body.
 * Resolves only when the server accepted the new key.
 */
export async function rotateOwnerKey(
  workspaceId: string,
  currentOwnerKey: string,
  newOwnerKey: string,
): Promise<void> {
  const url = `${collabHttpBase()}${WORKSPACE_API_PATH}/${encodeURIComponent(workspaceId)}/rotate`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${currentOwnerKey}`,
      },
      body: JSON.stringify({ newOwnerKey }),
    });
  } catch {
    throw new Error("Could not reach the workspace server. The owner key was not changed.");
  }
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  throw new Error(rotateError(response.status, body));
}

/**
 * A passphrase-derived owner key.
 *
 * Why PBKDF2-HMAC-SHA-256 rather than argon2id: Suite takes no new dependency
 * for this, and WebCrypto offers PBKDF2 everywhere it offers SHA-256, while
 * argon2 needs a native or WASM library. PBKDF2 is the weaker choice — it uses
 * almost no memory, so GPUs and ASICs can test far more guesses per second than
 * they could against a memory-hard function — and 600 000 iterations is the
 * OWASP figure for PBKDF2-HMAC-SHA-256, about a third of a second on a laptop.
 * The cost is that the passphrase has to carry the entropy itself, which is why
 * the strength floor below is four words rather than four characters.
 *
 * The salt is SHA-256("suite.owner.v1:" + workspaceId). The workspace id is
 * public already, and hashing it fixes one 32-byte salt per workspace, so the
 * same passphrase in two workspaces derives two unrelated keys.
 */
export const PASSPHRASE_ITERATIONS = 600_000;
export const PASSPHRASE_MIN_CHARS = 16;
export const PASSPHRASE_MIN_WORDS = 4;
const PASSPHRASE_SALT_PREFIX = "suite.owner.v1:";

/**
 * Casing, accents and spacing are forgiven: a person retyping a passphrase on
 * another device must not be locked out by a capital letter or a double space.
 */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * The same passphrase and workspace id always produce the same owner key, on
 * every device, with no file and no account. The derived key is an ordinary
 * owner key: it is stored and claimed exactly like a random one, so the relay
 * needs no change and sees only its hash.
 */
export async function deriveOwnerKey(passphrase: string, workspaceId: string): Promise<string> {
  const normalized = normalizePassphrase(passphrase);
  if (normalized.length === 0) throw new Error("Enter a passphrase to derive a key.");
  const workspace = workspaceId.trim();
  if (workspace.length === 0) throw new Error("A workspace id is needed to derive a key.");

  const encoder = new TextEncoder();
  const salt = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${PASSPHRASE_SALT_PREFIX}${workspace}`),
  );
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalized),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSPHRASE_ITERATIONS },
    material,
    OWNER_KEY_BYTES * 8,
  );
  return ownerKeyFromBytes(new Uint8Array(bits));
}

/** Passphrases that are common enough to be tried first by anyone guessing. */
const WEAK_PASSPHRASES = new Set([
  "correct horse battery staple",
  "iloveyou",
  "letmein",
  "password",
  "password123",
  "qwerty",
  "qwertyuiop",
  "secret",
  "suite",
  "welcome",
  "welcome123",
]);

/**
 * Why this passphrase is too weak, or `null` when it is usable. Every message
 * names the rule it broke and how to fix it, because the dialog shows the
 * reason instead of only disabling its button.
 */
export function passphraseProblem(passphrase: string): string | null {
  const normalized = normalizePassphrase(passphrase);
  const words = normalized.length === 0 ? [] : normalized.split(" ");
  const characters = [...normalized].length;

  if (characters === 0) {
    return "Enter a passphrase of at least four words. Four unrelated words are easy to remember and hard to guess, and Suite never stores them.";
  }
  if (words.length < PASSPHRASE_MIN_WORDS && characters < PASSPHRASE_MIN_CHARS) {
    return `Use at least ${PASSPHRASE_MIN_WORDS} words and ${PASSPHRASE_MIN_CHARS} characters: that is ${words.length} word${words.length === 1 ? "" : "s"} and ${characters} characters.`;
  }
  if (words.length < PASSPHRASE_MIN_WORDS) {
    const missing = PASSPHRASE_MIN_WORDS - words.length;
    return `Add ${missing} more word${missing === 1 ? "" : "s"}: a passphrase needs ${PASSPHRASE_MIN_WORDS} words, because a short one can be guessed offline.`;
  }
  if (characters < PASSPHRASE_MIN_CHARS) {
    return `That is ${characters} characters. Use at least ${PASSPHRASE_MIN_CHARS}, so the phrase is not just four short words.`;
  }
  if (new Set(words).size < PASSPHRASE_MIN_WORDS) {
    return `Use ${PASSPHRASE_MIN_WORDS} different words: repeating a word adds nothing to guess.`;
  }
  if (WEAK_PASSPHRASES.has(normalized)) {
    return "That is one of the first passphrases anyone guessing would try. Choose four unrelated words of your own.";
  }
  if (/^[^a-z]+$/u.test(normalized)) {
    return "Use words, not only digits or symbols: those are guessed first.";
  }
  if (/(.)\1{5,}/u.test(normalized)) {
    return "One character is repeated many times. Use four separate words instead.";
  }
  return null;
}
