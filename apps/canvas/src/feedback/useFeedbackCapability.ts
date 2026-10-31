import { useEffect, useState } from "react";
import { feedbackCapability } from "./feedbackClient";

/**
 * Whether this deployment takes feedback, and whether it wants a challenge.
 *
 * Asked once per surface that offers a form, by a hook rather than inside the form: the trigger
 * has to know before it can render, and a second copy of the question inside the form's first
 * paint would be a second request for an answer that does not change.
 */
export interface FeedbackAvailability {
  /** True when the deployment has somewhere to put a message. */
  configured: boolean;
  /** True when the server requires a Turnstile token. */
  captcha: boolean;
}

const UNKNOWN: FeedbackAvailability = { configured: false, captcha: false };

export function useFeedbackCapability(
  available: () => Promise<{ configured: boolean; captcha: boolean }> = feedbackCapability,
): FeedbackAvailability {
  const [capability, setCapability] = useState<FeedbackAvailability>(UNKNOWN);

  useEffect(() => {
    let live = true;
    void available().then((answer) => {
      if (!live) return;
      setCapability({ configured: answer.configured, captcha: answer.captcha });
    });
    return () => {
      live = false;
    };
  }, [available]);

  return capability;
}
