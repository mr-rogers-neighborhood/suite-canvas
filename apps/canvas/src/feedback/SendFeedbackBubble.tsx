import { useEffect, useRef, useState } from "react";
import { feedbackAvailable, sendFeedback } from "./feedbackClient";
import { toast } from "./toast";

/**
 * The one thing a person can say without knowing where to say it.
 *
 * It sits where a chat or handbook bubble would, at the bottom of the board, and
 * it asks for nothing but the words: one box, one button. No category, no email
 * field, no diagnostics — the message carries the build and the surface on its
 * own, because a person filing a thought should not be doing triage.
 *
 * It stays hidden until the deployment says it takes feedback, so a self-host
 * with no desk never offers a form that cannot send.
 */
export interface SendFeedbackBubbleProps {
  surface?: string;
  signedIn?: boolean;
  /** Replaced by a test; a build reads the deployment. */
  available?: () => Promise<boolean>;
  send?: typeof sendFeedback;
}

export function SendFeedbackBubble({
  surface = "board",
  signedIn = false,
  available = feedbackAvailable,
  send = sendFeedback,
}: SendFeedbackBubbleProps) {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let live = true;
    void available().then((ok) => {
      if (live) setShown(ok);
    });
    return () => {
      live = false;
    };
  }, [available]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!shown) return null;

  const submit = async () => {
    const words = text.trim();
    if (words.length === 0 || busy) return;
    setBusy(true);
    const outcome = await send({ text: words, surface, signedIn });
    setBusy(false);
    if (outcome.ok) {
      setText("");
      setOpen(false);
      toast.success("Thanks — your message is on its way.");
      return;
    }
    toast.failure(outcome.message);
  };

  return (
    <div className="pointer-events-none absolute right-4 bottom-4 z-30 flex flex-col items-end gap-2">
      {open ? (
        <div
          role="dialog"
          aria-label="Send feedback"
          data-testid="feedback-dialog"
          className="pointer-events-auto w-[300px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-3 shadow-lg"
        >
          <label className="text-[12px] font-medium text-[var(--ink)]" htmlFor="feedback-text">
            What is on your mind?
          </label>
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
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-[var(--ink-muted)]">Sends your app version too</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="feedback-cancel"
                className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="feedback-send"
                disabled={busy || text.trim().length === 0}
                onClick={() => void submit()}
                className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)] disabled:opacity-40"
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        data-testid="feedback-bubble"
        aria-label="Send feedback"
        title="Send feedback"
        className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3 text-[12px] text-[var(--ink-muted)] shadow-sm hover:text-[var(--ink)]"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">✎</span>
        Feedback
      </button>
    </div>
  );
}
