import type { IncomingMessage } from "node:http";
import { mailSenders, mailTransportFromEnv } from "@suite/auth";
import { readJsonBody, sendJson } from "@suite/billing";
import { createLogger, type Logger } from "../logging.js";
import type { RouteModule } from "../routes.js";

/**
 * The feedback bubble's landing place.
 *
 * Public and anonymous on purpose: the most useful message comes from somebody
 * who is stuck before they have an account. That makes this the one route in the
 * process that spends money for an unauthenticated caller, so the limiter and the
 * body cap are the feature rather than hardening added later — an endpoint that
 * mails on demand with neither is a spam relay wearing our domain.
 *
 * Nothing is stored. The message goes out through the same transport the account
 * mail uses, so a deployment that can send a verification link can send this, and
 * a deployment with no transport says so instead of accepting a message nobody
 * will read.
 */

export const FEEDBACK_PATH = "/api/feedback";
export const FEEDBACK_TO_VARIABLE = "SUITE_FEEDBACK_TO";

/** One message is a paragraph, not an essay. Anything larger is not a person typing. */
export const MAX_FEEDBACK_BYTES = 8 * 1024;
/** Characters a person can type into a bubble without it being a paste of a log. */
export const MAX_FEEDBACK_CHARS = 4000;
/** How many messages one address may send per window. */
export const FEEDBACK_PER_WINDOW = 5;
export const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;

export interface FeedbackModuleOptions {
  env: Readonly<Record<string, string | undefined>>;
  logger: Logger;
  /** Injected by a test so no mail leaves the process. */
  send?: (message: {
    text: string;
    surface: string;
    buildId: string;
    signedIn: boolean;
  }) => Promise<void>;
  now?: () => number;
}

/**
 * The caller's address, as the proxy in front of us reports it.
 *
 * Caddy sets `x-forwarded-for`; the socket's own address is the proxy's, which
 * would put every person in one bucket.
 */
function addressOf(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === "string" && first.length > 0) {
    return first.split(",")[0]?.trim() ?? "unknown";
  }
  return request.socket.remoteAddress ?? "unknown";
}

interface Entry {
  count: number;
  resetAt: number;
}

/** A fixed window per address. Small, in-process, and enough for five messages an hour. */
function limiter(now: () => number) {
  const hits = new Map<string, Entry>();
  return (key: string): { ok: boolean; retryAfter: number } => {
    const at = now();
    if (hits.size > 4096) {
      for (const [entry, value] of hits) if (value.resetAt <= at) hits.delete(entry);
    }
    const entry = hits.get(key);
    if (entry === undefined || entry.resetAt <= at) {
      hits.set(key, { count: 1, resetAt: at + FEEDBACK_WINDOW_MS });
      return { ok: true, retryAfter: 0 };
    }
    entry.count += 1;
    if (entry.count <= FEEDBACK_PER_WINDOW) return { ok: true, retryAfter: 0 };
    return { ok: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - at) / 1000)) };
  };
}

export function createFeedbackModule(options: FeedbackModuleOptions): RouteModule {
  const { env, logger } = options;
  const now = options.now ?? Date.now;
  const take = limiter(now);
  const to = (env[FEEDBACK_TO_VARIABLE] ?? "").trim();
  const buildId = (env.SUITE_VERSION ?? env.npm_package_version ?? "dev").trim();

  const send =
    options.send ??
    (async (message) => {
      const senders = mailSenders(
        mailTransportFromEnv(env, { write: (line) => logger.info("feedback", { line }) }),
        {
          feedbackTo: to,
        },
      );
      await senders.sendFeedback(message);
    });

  return {
    name: "feedback",
    async handle(request, response): Promise<boolean> {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path !== FEEDBACK_PATH) return false;

      const method = (request.method ?? "GET").toUpperCase();
      if (method === "OPTIONS") {
        response.writeHead(204, { allow: "GET, POST, OPTIONS" });
        response.end();
        return true;
      }

      // A capability probe, so the client can hide a bubble that cannot send
      // rather than offer a form and fail after someone has typed into it.
      if (method === "GET") {
        sendJson(response, 200, { ok: true, configured: to.length > 0 });
        return true;
      }
      if (method !== "POST") {
        response.setHeader("allow", "GET, POST, OPTIONS");
        sendJson(response, 405, {
          ok: false,
          error: "method_not_allowed",
          message: `${method} is not supported`,
        });
        return true;
      }
      if (to.length === 0) {
        sendJson(response, 503, {
          ok: false,
          error: "feedback-not-configured",
          message: `${FEEDBACK_TO_VARIABLE} is not set, so there is nowhere to send this`,
        });
        return true;
      }

      const limited = take(addressOf(request));
      if (!limited.ok) {
        response.setHeader("retry-after", String(limited.retryAfter));
        sendJson(response, 429, {
          ok: false,
          error: "too-many-requests",
          message: "That is a few messages already. Try again a little later.",
        });
        return true;
      }

      const body = await readJsonBody(request, MAX_FEEDBACK_BYTES);
      if (body.isErr()) {
        sendJson(response, 400, {
          ok: false,
          error: "invalid-request",
          message: body.error.message,
        });
        return true;
      }
      const fields = body.value as { text?: unknown; surface?: unknown; signedIn?: unknown };
      const text = typeof fields.text === "string" ? fields.text.trim() : "";
      if (text.length === 0) {
        sendJson(response, 400, {
          ok: false,
          error: "invalid-request",
          message: "text is required",
        });
        return true;
      }
      if (text.length > MAX_FEEDBACK_CHARS) {
        sendJson(response, 400, {
          ok: false,
          error: "invalid-request",
          message: `text is longer than ${MAX_FEEDBACK_CHARS} characters`,
        });
        return true;
      }

      try {
        await send({
          text,
          surface: typeof fields.surface === "string" ? fields.surface.slice(0, 40) : "unknown",
          buildId,
          signedIn: fields.signedIn === true,
        });
        logger.info("feedback sent", {
          surface: typeof fields.surface === "string" ? fields.surface : "unknown",
        });
        sendJson(response, 200, { ok: true });
      } catch (error) {
        // Never a false thanks: a message that did not leave is a failure the
        // sender has to see, or they will assume it arrived.
        logger.error("feedback did not send", {
          error: error instanceof Error ? error.message : String(error),
        });
        sendJson(response, 502, {
          ok: false,
          error: "feedback-failed",
          message: "The message did not send. Try again in a moment.",
        });
      }
      return true;
    },
  };
}

/** The mounted module. */
export const module: RouteModule = createFeedbackModule({
  env: process.env,
  logger: createLogger(),
});
