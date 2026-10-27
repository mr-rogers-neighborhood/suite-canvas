/**
 * Which starter shapes the launcher offers, and where that list comes from.
 *
 * The list belongs to the deployment rather than the bundle: an operator edits a
 * starter in the admin panel and the next launch shows the edit, with no release.
 * That server is not always there — a standalone build has none, a laptop with no
 * network cannot reach one — so the answer is cached, and the built-in starters in
 * `@suite/graph` are the floor. There is always a starter to open, and it is never
 * an empty select or a spinner over one.
 */

import { STARTER_TEMPLATES, type WorkspaceTemplate, workspaceTemplateSchema } from "@suite/graph";
import { accountHttpBase } from "../session/endpoints";
import { isStandalone } from "../session/mode";

/** Public on purpose: the launcher needs the list before anyone has signed in. */
export const TEMPLATES_PATH = "/api/templates";

/**
 * Versioned, both in the key and in what the key holds: a payload written by an
 * older build is a miss rather than a half-read, and needs no migration code.
 */
export const STARTER_TEMPLATES_CACHE_KEY = "suite.starterTemplates.v1";

/** The shape a new workspace starts as when nobody chooses otherwise. */
export const DEFAULT_STARTER_TEMPLATE_ID = "notebook";

/**
 * Long enough for a phone on a slow network, short enough that the select is not
 * held open by a server that is never going to answer.
 */
export const STARTER_TEMPLATES_TIMEOUT_MS = 1500;

function cacheStorage(): Storage | null {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
    ? window.localStorage
    : null;
}

/** The cached list, or null when there is none, or none that parses. */
export function readCachedStarterTemplates(): readonly WorkspaceTemplate[] | null {
  const storage = cacheStorage();
  if (storage === null) return null;
  const raw = storage.getItem(STARTER_TEMPLATES_CACHE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const templates = workspaceTemplateSchema.array().parse(parsed);
    if (templates.length === 0) throw new Error("empty");
    return templates;
  } catch {
    // Worthless is worth discarding: leaving it would make every launch pay for
    // the same failed parse, and the next answer from the server could not land.
    storage.removeItem(STARTER_TEMPLATES_CACHE_KEY);
    return null;
  }
}

/** Keeps the last good answer, so the next launch is a read rather than a request. */
export function cacheStarterTemplates(templates: readonly WorkspaceTemplate[]): void {
  const storage = cacheStorage();
  if (storage === null || templates.length === 0) return;
  try {
    storage.setItem(STARTER_TEMPLATES_CACHE_KEY, JSON.stringify(templates));
  } catch {
    // A full or disabled localStorage costs the cache, never the launcher.
  }
}

/**
 * One row of `/api/templates`, turned back into the template it describes.
 *
 * The row's own name and description win over the authored ones: they are what an
 * operator can change without editing the boards, and a starter that shows its old
 * name after a rename is a bug the reader would blame on the cache.
 */
function templateFromRow(row: unknown): WorkspaceTemplate | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;
  const data =
    typeof record.data === "object" && record.data !== null && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {};
  const authored = typeof data.description === "string" ? data.description.trim() : "";
  const description =
    typeof record.description === "string" && record.description.trim().length > 0
      ? record.description
      : authored.length > 0
        ? authored
        : record.name;
  const parsed = workspaceTemplateSchema.safeParse({
    ...data,
    id: record.id,
    name: record.name,
    description,
    version: typeof record.version === "number" && record.version >= 1 ? record.version : 1,
  });
  return parsed.success ? parsed.data : null;
}

export interface StarterTemplateOptions {
  /** Origin for the request; a test passes one instead of the build's. */
  base?: string;
  /** Replaced by a test; a build never sets it. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * The server's list, or null when it did not answer with one worth using. Every
 * error is the same error here: the caller has a fallback, so there is nothing to
 * report to the reader about a request they did not make.
 */
export async function fetchStarterTemplates(
  options: StarterTemplateOptions = {},
): Promise<readonly WorkspaceTemplate[] | null> {
  // A standalone build has no control plane to ask, and a bundle that asked anyway
  // would log a 404 on every launch. An injected `fetch` is a test saying it knows
  // better than the build profile.
  if (options.fetch === undefined && isStandalone()) return null;
  const call = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? STARTER_TEMPLATES_TIMEOUT_MS,
  );
  try {
    const response = await call(`${options.base ?? accountHttpBase()}${TEMPLATES_PATH}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const { templates } = body as { templates?: unknown };
    if (!Array.isArray(templates)) return null;
    // An empty list is an answer, not a failure: an operator deleting the last
    // server template must not leave this browser showing it forever.
    return templates
      .map(templateFromRow)
      .filter((template): template is WorkspaceTemplate => template !== null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The built-ins plus whatever the server added, server first.
 *
 * The built-ins are never replaced wholesale: Notebook is the default workspace
 * shape, so a deployment whose table holds one hand-made template must not lose
 * it, and a first launch against an empty table must still offer one. A server
 * template with the same id wins, which is how a built-in is edited without a
 * rebuild.
 */
export function mergeStarterTemplates(
  built: readonly WorkspaceTemplate[],
  fetched: readonly WorkspaceTemplate[],
): readonly WorkspaceTemplate[] {
  const served = new Set(fetched.map((template) => template.id));
  return [...fetched, ...built.filter((template) => !served.has(template.id))];
}

/**
 * The list to show: the cache when it has one, the server merged over the
 * built-ins, and the built-ins alone when nothing answers. Never empty, never
 * throws.
 */
export async function loadStarterTemplates(
  options: StarterTemplateOptions = {},
): Promise<readonly WorkspaceTemplate[]> {
  const cached = readCachedStarterTemplates();
  if (cached !== null) {
    // Stale-while-revalidate: a template deleted in the operator panel must not
    // sit in this browser until someone clears site data, and the launcher must
    // not wait on the network to draw. The next visit shows the new list.
    void fetchStarterTemplates(options).then((fresh) => {
      if (fresh !== null) cacheStarterTemplates(mergeStarterTemplates(STARTER_TEMPLATES, fresh));
    });
    return cached;
  }
  const fetched = await fetchStarterTemplates(options);
  if (fetched === null) return STARTER_TEMPLATES;
  const merged = mergeStarterTemplates(STARTER_TEMPLATES, fetched);
  cacheStarterTemplates(merged);
  return merged;
}

/** The template with this id, for a select whose value is an id. */
export function starterTemplateById(
  templates: readonly WorkspaceTemplate[],
  id: string,
): WorkspaceTemplate | undefined {
  return templates.find((template) => template.id === id);
}

/**
 * One record, and only for the workspace it names: a second New workspace replaces
 * the first rather than piling entries up, and `takeChosenTemplate` reads it back.
 */
export const CHOSEN_TEMPLATE_KEY = "suite.chosenTemplate.v1";

/**
 * Hands the chosen template over as the object it is. The `?template=` parameter
 * carries an id, and an id only resolves a starter this bundle was built with — a
 * starter that came from the server has no entry in `STARTER_TEMPLATES`, so the id
 * alone would silently apply nothing. `applyWorkspaceTemplate` takes the object.
 */
export function rememberChosenTemplate(workspaceId: string, template: WorkspaceTemplate): void {
  const storage = cacheStorage();
  if (storage === null) return;
  try {
    storage.setItem(CHOSEN_TEMPLATE_KEY, JSON.stringify({ workspaceId, template }));
  } catch {
    // Losing the handoff costs the template, not the workspace: the id in the URL
    // still opens the board for a template the bundle carries.
  }
}

/** The template handed over for this workspace, once. */
export function takeChosenTemplate(workspaceId: string): WorkspaceTemplate | null {
  const storage = cacheStorage();
  if (storage === null) return null;
  const raw = storage.getItem(CHOSEN_TEMPLATE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not a record");
    const { workspaceId: target, template } = parsed as {
      workspaceId?: unknown;
      template?: unknown;
    };
    if (target !== workspaceId) return null;
    storage.removeItem(CHOSEN_TEMPLATE_KEY);
    return workspaceTemplateSchema.parse(template);
  } catch {
    storage.removeItem(CHOSEN_TEMPLATE_KEY);
    return null;
  }
}
