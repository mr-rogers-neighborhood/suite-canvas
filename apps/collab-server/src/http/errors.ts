/**
 * Every way an HTTP handler in the relay fails, as one tagged union.
 *
 * A handler throws `HttpError` and one `catch` at its boundary answers, so the
 * failure travels as data: the tag says what went wrong and `httpStatus` is the
 * only place a status code is decided. Call sites name the failure they have
 * (`HttpError.notFound(...)`) instead of repeating a number that the responder
 * would then have to interpret.
 */

export type HttpProblem =
  | { readonly tag: "bad-request"; readonly message: string }
  | { readonly tag: "unauthorized"; readonly message: string }
  | { readonly tag: "forbidden"; readonly message: string }
  | { readonly tag: "not-found"; readonly message: string }
  | { readonly tag: "method-not-allowed"; readonly message: string; readonly allow?: string }
  | { readonly tag: "conflict"; readonly message: string }
  | { readonly tag: "payload-too-large"; readonly message: string }
  | { readonly tag: "unsupported-media"; readonly message: string }
  | { readonly tag: "rate-limited"; readonly message: string; readonly retryAfter: number }
  | { readonly tag: "internal"; readonly message: string }
  | { readonly tag: "not-implemented"; readonly message: string }
  | { readonly tag: "unavailable"; readonly message: string }
  | { readonly tag: "insufficient-storage"; readonly message: string };

const STATUS_BY_TAG = {
  "bad-request": 400,
  unauthorized: 401,
  forbidden: 403,
  "not-found": 404,
  "method-not-allowed": 405,
  conflict: 409,
  "payload-too-large": 413,
  "unsupported-media": 415,
  "rate-limited": 429,
  internal: 500,
  "not-implemented": 501,
  unavailable: 503,
  "insufficient-storage": 507,
} as const satisfies Record<HttpProblem["tag"], number>;

const TAG_BY_STATUS: Record<number, HttpProblem["tag"]> = Object.fromEntries(
  Object.entries(STATUS_BY_TAG).map(([tag, status]) => [status, tag as HttpProblem["tag"]]),
);

/** The one status decision in the relay: a problem tag to its status code. */
export function httpStatus(problem: HttpProblem): number {
  return STATUS_BY_TAG[problem.tag];
}

/**
 * A problem for a call site that already carries a status code (quota refusals
 * travel as `{ status, message }`). An unknown status reads as a server fault:
 * the message is still the caller's, the code is never invented.
 */
export function httpProblem(status: number, message: string): HttpProblem {
  const tag = TAG_BY_STATUS[status];
  switch (tag) {
    case "method-not-allowed":
      return { tag, message };
    case "rate-limited":
      return { tag, message, retryAfter: 0 };
    case undefined:
      return { tag: "internal", message };
    default:
      return { tag, message };
  }
}

/**
 * The throwable carrier. It exists so a handler can fail from anywhere in its
 * body and still be answered by the single mapping at its boundary; the tag is
 * the value, the class is only transport.
 */
export class HttpError extends Error {
  constructor(readonly problem: HttpProblem) {
    super(problem.message);
    this.name = "HttpError";
  }

  /** Kept for callers that only need the code (tests, logs, legacy adapters). */
  get status(): number {
    return httpStatus(this.problem);
  }

  static badRequest(message: string): HttpError {
    return new HttpError({ tag: "bad-request", message });
  }

  static unauthorized(message: string): HttpError {
    return new HttpError({ tag: "unauthorized", message });
  }

  static forbidden(message: string): HttpError {
    return new HttpError({ tag: "forbidden", message });
  }

  static notFound(message: string): HttpError {
    return new HttpError({ tag: "not-found", message });
  }

  static methodNotAllowed(allow?: string): HttpError {
    return new HttpError({
      tag: "method-not-allowed",
      message: "Method not allowed.",
      ...(allow ? { allow } : {}),
    });
  }

  static conflict(message: string): HttpError {
    return new HttpError({ tag: "conflict", message });
  }

  static payloadTooLarge(message: string): HttpError {
    return new HttpError({ tag: "payload-too-large", message });
  }

  static unsupportedMedia(message: string): HttpError {
    return new HttpError({ tag: "unsupported-media", message });
  }

  static rateLimited(retryAfter: number, message: string): HttpError {
    return new HttpError({ tag: "rate-limited", message, retryAfter });
  }

  static internal(message: string): HttpError {
    return new HttpError({ tag: "internal", message });
  }

  static notImplemented(message: string): HttpError {
    return new HttpError({ tag: "not-implemented", message });
  }

  static unavailable(message: string): HttpError {
    return new HttpError({ tag: "unavailable", message });
  }

  static insufficientStorage(message: string): HttpError {
    return new HttpError({ tag: "insufficient-storage", message });
  }
}

/** The problem an error carries, or `null` when it is not one of ours. */
export function toProblem(error: unknown): HttpProblem | null {
  return error instanceof HttpError ? error.problem : null;
}
