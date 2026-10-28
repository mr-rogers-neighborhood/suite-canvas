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
      reason: "not-configured" | "rate-limited" | "unreachable" | "refused" | "captcha";
      message: string;
    };

export interface FeedbackInput {
  text: string;
  surface: string;
  signedIn: boolean;
  /** The Turnstile token, when the deployment requires one. */
  captchaToken?: string | undefined;
  base?: string;
  fetch?: typeof globalThis.fetch;
}

/** What the deployment offers: nothing, a plain form, or a form behind a challenge. */
export interface FeedbackCapability {
  /** The bubble is hidden unless this is true. */
  configured: boolean;
  /** The form has to carry a Turnstile token before it sends. */
  captcha: boolean;
}

const NOTHING: FeedbackCapability = { configured: false, captcha: false };

/**
 * Whether this deployment takes feedback, and whether it asks for a challenge.
 *
 * The two are asked together because the bubble has to know both before somebody
 * types: a form that reveals a widget after the first keystroke is worse than one
 * that shows it up front, and a form with no widget would send a message the
 * server refuses.
 */
export async function feedbackCapability(
  input: { base?: string; fetch?: typeof globalThis.fetch } = {},
): Promise<FeedbackCapability> {
  const call = input.fetch ?? globalThis.fetch;
  try {
    const response = await call(`${input.base ?? accountHttpBase()}${FEEDBACK_PATH}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return NOTHING;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return NOTHING;
    const { configured, captcha } = body as { configured?: unknown; captcha?: unknown };
    if (configured !== true) return NOTHING;
    return { configured: true, captcha: captcha === true };
  } catch {
    return NOTHING;
  }
}

/** Whether this deployment takes feedback at all, so the bubble can stay hidden. */
export async function feedbackAvailable(
  input: { base?: string; fetch?: typeof globalThis.fetch } = {},
): Promise<boolean> {
  return (await feedbackCapability(input)).configured;
}

export async function sendFeedback(input: FeedbackInput): Promise<FeedbackOutcome> {
  const call = input.fetch ?? globalThis.fetch;
  try {
    const response = await call(`${input.base ?? accountHttpBase()}${FEEDBACK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        surface: input.surface,
        signedIn: input.signedIn,
        ...(input.captchaToken === undefined ? {} : { captchaToken: input.captchaToken }),
      }),
    });
    if (response.ok) return { ok: true };
    const body: unknown = await response.json().catch(() => null);
    const read = (field: "message" | "error"): string | null => {
      if (typeof body !== "object" || body === null) return null;
      const value = (body as Record<string, unknown>)[field];
      return typeof value === "string" ? value : null;
    };
    const message = read("message") ?? "The message did not send.";
    if (response.status === 429) return { ok: false, reason: "rate-limited", message };
    if (response.status === 503) return { ok: false, reason: "not-configured", message };
    // The challenge failed or expired. The code is the server's own, not a guess at
    // the prose: a token is single-use, so the bubble must ask for a fresh one rather
    // than repeat an identical request.
    if (read("error") === "captcha-failed") return { ok: false, reason: "captcha", message };
    return { ok: false, reason: "refused", message };
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: "Could not reach the server. Your message was not sent.",
    };
  }
}
