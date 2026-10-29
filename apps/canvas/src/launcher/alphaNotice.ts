/**
 * Whether the alpha notice has been read in this browser.
 *
 * A browser-local fact, not a document fact, so it lives in `localStorage` beside the pins
 * and the recents: it is about this machine's reader having seen a sentence, and an account
 * that remembered it would show the notice again on every other device for no reason.
 *
 * Every failure reads as "not seen": a browser with storage denied shows the notice once
 * per visit, which is the harmless direction to be wrong in.
 */
const KEY = "suite.alpha-notice.v1";

export function alphaNoticeSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "seen";
  } catch {
    return false;
  }
}

export function rememberAlphaNotice(): void {
  try {
    window.localStorage.setItem(KEY, "seen");
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
