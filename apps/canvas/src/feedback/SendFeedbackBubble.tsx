import { useEffect, useState } from "react";
import { FeedbackComposer } from "./FeedbackComposer";
import type { sendFeedback } from "./feedbackClient";
import { type FeedbackAvailability, useFeedbackCapability } from "./useFeedbackCapability";

/**
 * The one thing a person can say without knowing where to say it.
 *
 * It sits where a chat or handbook bubble would, at the bottom of the board, and
 * it asks for nothing but the words: one box, one button. No category, no email
 * field, no diagnostics — the message carries the build and the surface on its
 * own, because a person filing a thought should not be doing triage.
 *
 * The form itself is `FeedbackComposer`, which the handbook's footer also uses: the
 * launcher keeps this trigger, and the board hands its corner to the handbook.
 *
 * It stays hidden until the deployment says it takes feedback, so a self-host
 * with no desk never offers a form that cannot send.
 */
export interface SendFeedbackBubbleProps {
  surface?: string;
  signedIn?: boolean;
  /** Replaced by a test; a build reads the deployment. */
  available?: () => Promise<FeedbackAvailability>;
  /** Replaced by a test; a build reads the deployment. */
  siteKey?: string | null;
  send?: typeof sendFeedback;
}

export function SendFeedbackBubble({
  surface = "board",
  signedIn = false,
  available,
  siteKey,
  send,
}: SendFeedbackBubbleProps) {
  const [open, setOpen] = useState(false);
  const capability = useFeedbackCapability(available);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!capability.configured) return null;

  return (
    <div className="pointer-events-none absolute right-4 bottom-4 z-30 flex flex-col items-end gap-2">
      {open ? (
        <div className="pointer-events-auto w-[300px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-3 shadow-lg">
          <FeedbackComposer
            surface={surface}
            signedIn={signedIn}
            captcha={capability.captcha}
            {...(siteKey === undefined ? {} : { siteKey })}
            {...(send === undefined ? {} : { send })}
            onCancel={() => setOpen(false)}
            onSent={() => setOpen(false)}
          />
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
