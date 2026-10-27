import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Logger } from "../logging.js";
import { isRouteModule, type RouteModule } from "../routes.js";

/**
 * The module table. Two agents add `auth.ts` and `billing.ts` beside this file;
 * until they do, the host starts with zero modules and says so once per name.
 *
 * The imports are dynamic on purpose. A static `import "./auth.js"` would make
 * this file — and therefore the whole host — fail to compile and fail to boot
 * while the module is absent, which inverts the requirement: the contract has
 * to be shippable before its first implementation. It also keeps the host free
 * of `@suite/auth` and `@suite/billing`: the build graph here must stay empty of
 * both, so the control plane cannot reach a document or a graph type.
 */

/** The module files this package expects, in mount order. */
export const MODULE_NAMES = ["auth", "billing", "admin"] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];

/** What `/health` reports for one name. */
export type ModuleState = "mounted" | "absent" | "failed";

export interface ModuleStatus {
  name: string;
  state: ModuleState;
  /** Why it failed; never a value from the environment. */
  detail?: string;
}

export interface LoadedModules {
  /** Mounted modules only, in `MODULE_NAMES` order. */
  modules: readonly RouteModule[];
  /** One entry per expected name, mounted or not, for `/health`. */
  status: readonly ModuleStatus[];
}

/** Source first (tsx runs the TypeScript tree), then a built file beside it. */
const CANDIDATE_EXTENSIONS = [".ts", ".js"] as const;

function moduleFile(directory: string, name: string): string | null {
  for (const extension of CANDIDATE_EXTENSIONS) {
    const path = join(directory, `${name}${extension}`);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * A module may export its object as `default`, as `module`/`routeModule`, or as
 * a single named export. Accepting all three means a module author cannot fail
 * the boot over a naming decision that was never written down.
 */
function routeModuleFrom(loaded: unknown): RouteModule | null {
  if (typeof loaded !== "object" || loaded === null) return null;
  const exports = loaded as Record<string, unknown>;
  for (const key of ["default", "module", "routeModule"]) {
    const candidate = exports[key];
    if (isRouteModule(candidate)) return candidate;
  }
  for (const candidate of Object.values(exports)) {
    if (isRouteModule(candidate)) return candidate;
  }
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads whatever is on disk. A missing file is a log line; an unimportable or
 * malformed one is a log line plus a `failed` health entry. Neither stops the
 * process: `/health` is how a deployment learns that a module is missing, and a
 * crash loop would only hide the answer.
 */
export async function loadModules(options: {
  logger: Logger;
  /** Overridable so a test can point the loader at fixtures. */
  directory?: string;
}): Promise<LoadedModules> {
  const directory = options.directory ?? import.meta.dirname;
  const modules: RouteModule[] = [];
  const status: ModuleStatus[] = [];

  for (const name of MODULE_NAMES) {
    const file = moduleFile(directory, name);
    if (file === null) {
      options.logger.info("route module absent", { module: name, directory });
      status.push({ name, state: "absent" });
      continue;
    }
    try {
      const loaded: unknown = await import(pathToFileURL(file).href);
      const found = routeModuleFrom(loaded);
      if (found === null) {
        throw new Error(`${file} exports no object with a name and a handle function`);
      }
      modules.push(found);
      status.push({ name, state: "mounted" });
    } catch (error) {
      options.logger.error("route module failed to load", {
        module: name,
        error: messageOf(error),
      });
      status.push({ name, state: "failed", detail: messageOf(error) });
    }
  }

  return { modules, status };
}
