import { accountHttpBase } from "../session/endpoints";

/**
 * Sending a message from the bubble.
 *
 * The bubble is the one place a person can say something went wrong without
 * knowing where to say it, so the failure has to be as explicit as the success:
 * a "thanks" for a message that never left is worse than no bubble at all.
 */
export const FEEDBACK_PATH = "/api/feedback";

export type FeedbackOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "not-configured" | "rate-limited" | "unreachable" | "refused";
      message: string;
    };

export interface FeedbackInput {
  text: string;
  surface: string;
  signedIn: boolean;
  base?: string;
  fetch?: typeof globalThis.fetch;
}

/** Whether this deployment takes feedback at all, so the bubble can stay hidden. */
export async function feedbackAvailable(
  input: { base?: string; fetch?: typeof globalThis.fetch } = {},
): Promise<boolean> {
  const call = input.fetch ?? globalThis.fetch;
  try {
    const response = await call(`${input.base ?? accountHttpBase()}${FEEDBACK_PATH}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { configured?: unknown }).configured === true
    );
  } catch {
    return false;
  }
}

export async function sendFeedback(input: FeedbackInput): Promise<FeedbackOutcome> {
  const call = input.fetch ?? globalThis.fetch;
  try {
    const response = await call(`${input.base ?? accountHttpBase()}${FEEDBACK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: input.text, surface: input.surface, signedIn: input.signedIn }),
    });
    if (response.ok) return { ok: true };
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === "object" &&
      body !== null &&
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : "The message did not send.";
    if (response.status === 429) return { ok: false, reason: "rate-limited", message };
    if (response.status === 503) return { ok: false, reason: "not-configured", message };
    return { ok: false, reason: "refused", message };
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: "Could not reach the server. Your message was not sent.",
    };
  }
}
