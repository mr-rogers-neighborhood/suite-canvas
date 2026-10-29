/**
 * When this browser last read the alpha notice.
 *
 * A browser-local fact, not a document fact, so it lives in `localStorage` beside the pins and
 * the recents: it is about this machine's reader having seen a sentence, and an account that
 * remembered it would show the notice again on every other device for no reason.
 *
 * It is a timestamp rather than a flag because the notice is worth repeating while the product
 * is alpha: somebody who comes back tomorrow should be reminded what they are using, and one who
 * reopens the tab a minute later should not. `REOPEN_AFTER_MS` is that line.
 *
 * Every failure reads as "not seen": a browser with storage denied shows the notice on each
 * visit, which is the harmless direction to be wrong in.
 */
const KEY = "suite.alpha-notice.v2";

/** How long a dismissal stands. Ten minutes is one working session's opening. */
export const REOPEN_AFTER_MS = 10 * 60 * 1000;

/**
 * When it was last dismissed, or null when it never was.
 *
 * The key changed with this rule, so a `"seen"` written by the once-per-browser version is never
 * parsed: it is read as "no timestamp", and the notice appears.
 */
function dismissedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const stamp = Number(raw);
    return Number.isFinite(stamp) && stamp > 0 ? stamp : null;
  } catch {
    return null;
  }
}

export function alphaNoticeSeen(now: number = Date.now()): boolean {
  const stamp = dismissedAt();
  if (stamp === null) return false;
  // A clock that went backwards (a machine resuming, a manual change) makes the difference
  // negative, which reads as "recently seen" and keeps the notice away until it settles.
  return now - stamp < REOPEN_AFTER_MS;
}

export function rememberAlphaNotice(now: number = Date.now()): void {
  try {
    window.localStorage.setItem(KEY, String(now));
  } catch {
    // Nothing to do: the notice shows again next visit, which is not worth a warning.
  }
}

/** For tests and for a reader who wants the notice back. */
export function forgetAlphaNotice(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}
