import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BillingError,
  billingFailureOf,
  createEntitlementReader,
  createPostgresSubscriptions,
  type OrganizationEntitlements,
  parseTierTable,
  planList,
  readJsonBody,
  sendJson,
  statusOf,
  type TierTable,
} from "@suite/billing";
import { envWithSettings } from "@suite/settings";
import { type ConfigEnv, DATABASE_URL_VARIABLE } from "../config.js";
import { createLogger, type Logger, REQUEST_ID_HEADER } from "../logging.js";
import type { RouteModule } from "../routes.js";
import { stripeCredentials } from "./auth-billing.js";
import { readStoredSettings } from "./settings.js";

/**
 * The billing routes the Stripe plugin does not own.
 *
 * The plugin answers everything under `/api/auth/*`: checkout at
 * `/api/auth/subscription/upgrade`, the portal at `/api/auth/subscription/billing-portal`,
 * and the webhook at `/api/auth/stripe/webhook`. This module owns `/api/billing/*` and
 * nothing else, so `/api/auth/stripe/webhook` is answered once, by the auth module.
 *
 * Two paths are here:
 *
 *   POST /api/billing/entitlement  {"organizationId":"org_1"} → {"tier":"personal","limits":{…}}
 *   POST /api/billing/plans        → {"plans":[{"tier":"personal","priceId":"price_…","limits":{…}}]}
 *
 * The first is the read ADR-0075 mints tokens from; the second is the price list a
 * surface renders, so no client hardcodes a price id.
 */

export const BILLING_PREFIX = "/api/billing";
export const ENTITLEMENT_PATH = "/api/billing/entitlement";
export const PLANS_PATH = "/api/billing/plans";

/** Longest organization id accepted: Better Auth's own ids are far shorter. */
const MAX_ID_LENGTH = 128;

export interface BillingModuleDeps {
  entitlements: OrganizationEntitlements;
  tiers: TierTable;
  /**
   * Which Stripe universe these tiers belong to.
   *
   * The catalogue is published from the *active* mode's price table, because a test price
   * id in a live checkout opens nothing. It rides in the response so a surface can say
   * "these are test cards" instead of leaving the reader to guess who is being charged.
   */
  mode: "test" | "live";
}

export interface BillingModuleOptions {
  /** Resolved on the first request, so an import never needs a database. */
  resolve: () => Promise<BillingModuleDeps>;
  logger: Logger;
}

function pathnameOf(target: string | undefined): string {
  if (target === undefined) return "/";
  try {
    return new URL(target, "http://control-plane.invalid").pathname;
  } catch {
    return target.split("?")[0] ?? "/";
  }
}

function owns(path: string): boolean {
  return path === BILLING_PREFIX || path.startsWith(`${BILLING_PREFIX}/`);
}

function requestIdOf(request: IncomingMessage): string | undefined {
  const value = request.headers[REQUEST_ID_HEADER];
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `organizationId` a body names, or the reason it names none. */
function organizationIdOf(body: unknown): string {
  const value = isObject(body) ? body.organizationId : undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BillingError("invalid-request", "organizationId is required");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_ID_LENGTH) {
    throw new BillingError("invalid-request", `organizationId is longer than ${MAX_ID_LENGTH}`);
  }
  return trimmed;
}

/**
 * Builds the module over injected dependencies.
 *
 * The dependencies are a promise factory rather than a value: the module file is loaded
 * before the process has validated its configuration, and a load failure there is a
 * missing route, not a boot failure. A resolution fault becomes a `503` on the routes,
 * logged once, which is how an operator learns the database URL is missing.
 */
export function createBillingModule(options: BillingModuleOptions): RouteModule {
  const logger = options.logger.child({ component: "billing-module" });
  let deps: BillingModuleDeps | null = null;
  let failure: BillingError | null = null;
  let loading: Promise<void> | null = null;

  async function dependencies(): Promise<BillingModuleDeps> {
    if (deps !== null) return deps;
    if (failure !== null) throw failure;
    loading ??= options
      .resolve()
      .then(
        (resolved) => {
          deps = resolved;
        },
        (error: unknown) => {
          failure = billingFailureOf(error);
          logger.error("billing routes are not configured", {
            code: failure.code,
            error: failure.message,
          });
        },
      )
      .finally(() => {
        loading = null;
      });
    await loading;
    if (deps !== null) return deps;
    throw failure ?? new BillingError("not-configured", "billing is not configured");
  }

  async function answer(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<boolean> {
    const requestId = requestIdOf(request);
    const resolved = await dependencies();

    if (path === PLANS_PATH) {
      sendJson(response, 200, {
        mode: resolved.mode,
        plans: planList(resolved.tiers).map((plan) => ({
          tier: plan.name,
          priceId: plan.priceId,
          limits: plan.limits,
        })),
      });
      return true;
    }

    const body = await readJsonBody(request);
    if (body.isErr()) {
      sendJson(response, statusOf(body.error), {
        error: body.error.code,
        message: body.error.message,
        requestId,
      });
      return true;
    }
    const organizationId = organizationIdOf(body.value);
    const entitlement = await resolved.entitlements.forOrganization(organizationId);
    sendJson(response, 200, entitlement);
    return true;
  }

  return {
    name: "billing",
    async handle(request, response): Promise<boolean> {
      const path = pathnameOf(request.url);
      // `/api/auth/*` belongs to the auth module: the plugin registered the webhook,
      // checkout and the portal there, and a second answer would split subscription state.
      if (!owns(path)) return false;
      if (path !== ENTITLEMENT_PATH && path !== PLANS_PATH) {
        sendJson(response, 404, { error: "not_found", requestId: requestIdOf(request) });
        return true;
      }
      if ((request.method ?? "GET").toUpperCase() !== "POST") {
        response.setHeader("allow", "POST");
        sendJson(response, 405, {
          error: "method_not_allowed",
          requestId: requestIdOf(request),
        });
        return true;
      }
      try {
        return await answer(request, response, path);
      } catch (error) {
        const failureOfRequest = billingFailureOf(error);
        logger.error("billing request failed", {
          code: failureOfRequest.code,
          error: failureOfRequest.message,
          path,
          requestId: requestIdOf(request),
        });
        sendJson(response, statusOf(failureOfRequest), {
          error: failureOfRequest.code,
          ...(failureOfRequest.code === "invalid-request"
            ? { message: failureOfRequest.message }
            : {}),
          requestId: requestIdOf(request),
        });
        return true;
      }
    },
  };
}

/** Reads the two variables these routes need. Throws the reason it cannot. */
export async function billingDepsFromEnvironment(
  env: ConfigEnv = process.env,
): Promise<BillingModuleDeps> {
  // The active mode's table, not the test one: a deployment running live must not publish
  // a catalogue of test price ids, and the panel reads the same table the plugin charges.
  const credentials = stripeCredentials(env);
  const parsed = parseTierTable(credentials.priceTiers);
  if (parsed.isErr()) throw parsed.error;
  const tiers = parsed.value;

  const connectionString = env[DATABASE_URL_VARIABLE]?.trim();
  if (connectionString === undefined || connectionString.length === 0) {
    throw new BillingError("not-configured", `${DATABASE_URL_VARIABLE} is not set`);
  }
  const subscriptions = await createPostgresSubscriptions({ connectionString });
  return {
    tiers,
    mode: credentials.mode,
    entitlements: createEntitlementReader({ subscriptions, tiers }),
  };
}

/**
 * The environment this process booted with, the panel's rows laid over it.
 *
 * The plugin beside this module is built once, at boot, from exactly that composition. A
 * module that read `process.env` instead published the *test* catalogue on a deployment
 * whose checkouts and webhook were live, because the mode lives in a row rather than in the
 * environment: two answers to one question, and the Plan tab showed the wrong prices
 * beside the button that charged the right ones.
 *
 * Resolved once. A process that has already spent one mode cannot honestly describe
 * another, and the panel's "restart to apply" marker is what says so; re-reading a row on
 * every request would make this the one place that pretends otherwise.
 */
let bootEnv: ConfigEnv | null = null;

export async function bootBillingEnvironment(
  read: typeof readStoredSettings = readStoredSettings,
): Promise<ConfigEnv> {
  if (bootEnv !== null) return bootEnv;
  const databaseUrl = (process.env[DATABASE_URL_VARIABLE] ?? "").trim();
  const rows = await read(databaseUrl).catch(() => []);
  bootEnv = envWithSettings({ env: process.env, rows });
  return bootEnv;
}

/** For a test, and for a process that changed the rows: the next read composes again. */
export function forgetBillingEnvironment(): void {
  bootEnv = null;
}

/**
 * The mounted module.
 *
 * The pool it opens is closed by process exit, which is what the host does after it
 * drains; a module has no shutdown hook of its own.
 */
export const module: RouteModule = createBillingModule({
  resolve: async () => billingDepsFromEnvironment(await bootBillingEnvironment()),
  logger: createLogger(),
});
