import { useCallback, useRef, useState } from "react";
import { captchaSiteKey } from "../auth/captchaKey";
import { TurnstileWidget } from "../auth/TurnstileWidget";
import { sendFeedback } from "./feedbackClient";
import { toast } from "./toast";

/**
 * The form half of feedback: one box, one button, and the challenge if the deployment asks.
 *
 * It is separate from whatever opened it (the launcher's bubble, the handbook's footer) because
 * the words are the same in both places. What changes is the `surface` the message is filed
 * against and, when a reader is reporting an article, the line naming it — a report that says
 * which paragraph it is about is worth ten that say "the app".
 */
export interface FeedbackComposerProps {
  surface?: string;
  signedIn?: boolean;
  /** A line put above the reader's words, naming whatever they were looking at. */
  context?: string | undefined;
  /** True when the server requires a Turnstile token for a send. */
  captcha?: boolean;
  /** Replaced by a test; a build reads the deployment. */
  siteKey?: string | null;
  send?: typeof sendFeedback;
  onSent?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  /** The question above the box; a handbook article can name itself instead. */
  placeholder?: string | undefined;
}

export function FeedbackComposer({
  surface = "board",
  signedIn = false,
  context,
  captcha = false,
  siteKey = captchaSiteKey(),
  send = sendFeedback,
  onSent,
  onCancel,
  placeholder = "What is on your mind?",
}: FeedbackComposerProps) {
  const [text, setText] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  // Stable across renders: the challenge must not be torn down because the words in the
  // box changed, which is what an inline arrow on `onToken` would do.
  const acceptToken = useCallback((next: string | null) => setToken(next ?? ""), []);

  const challengeNeeded = captcha && siteKey !== null;
  const ready = text.trim().length > 0 && (!challengeNeeded || token.length > 0);

  const submit = async () => {
    const words = text.trim();
    if (words.length === 0 || busy || !ready) return;
    setBusy(true);
    const outcome = await send({
      text: context === undefined ? words : `${context}\n\n${words}`,
      surface,
      signedIn,
      ...(challengeNeeded ? { captchaToken: token } : {}),
    });
    setBusy(false);
    if (outcome.ok) {
      setText("");
      setToken("");
      toast.success("Thanks — your message is on its way.");
      onSent?.();
      return;
    }
    // A spent or expired token is not the sender's mistake: ask the widget for a fresh one
    // and leave their words where they are.
    if (outcome.reason === "captcha") setToken("");
    toast.failure(outcome.message);
  };

  return (
    <div data-testid="feedback-dialog" className="flex flex-col">
      <label className="text-[12px] font-medium text-[var(--ink)]" htmlFor="feedback-text">
        {placeholder}
      </label>
      {context === undefined ? null : (
        <p
          className="mt-0.5 truncate text-[11px] text-[var(--ink-muted)]"
          data-testid="feedback-context"
        >
          {context}
        </p>
      )}
      <textarea
        id="feedback-text"
        ref={box}
        data-testid="feedback-text"
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
        }}
        className="mt-1.5 w-full resize-none rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-[12px] leading-5 text-[var(--ink)] outline-none focus:ring-1 focus:ring-blue-400"
      />
      {challengeNeeded ? (
        // Compact and interaction-only: the full-size widget is 300px wide and filled this
        // popover, and a managed challenge that passes silently has nothing to say, so it stays
        // out of the way until Cloudflare wants an answer.
        <div className="mt-2 max-w-[150px]" data-testid="feedback-captcha">
          <TurnstileWidget
            siteKey={siteKey}
            onToken={acceptToken}
            size="compact"
            appearance="interaction-only"
          />
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-[var(--ink-muted)]">Sends your app version too</span>
        <div className="flex items-center gap-1.5">
          {onCancel ? (
            <button
              type="button"
              data-testid="feedback-cancel"
              className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            data-testid="feedback-send"
            disabled={busy || !ready}
            onClick={() => void submit()}
            className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)] disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
