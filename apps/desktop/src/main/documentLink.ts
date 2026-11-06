import { join } from "node:path";
import { SUITE_PROTOCOL, workspaceTarget } from "@suite/contracts";

/**
 * A `suite://canvas/workspace/<name>` link, resolved against this machine's library.
 *
 * The hub opens a document by launching this shell with a link, so the rule is worth a test: the name
 * must be one this app opens — `looksLikeDocument`, the same predicate the open dialog and a handoff
 * use — and it must be inside the library. Anything else returns null, and the caller shows the
 * launcher rather than failing a link the person did not type.
 *
 * The predicate and the filesystem are parameters for the same reason `paths.ts` takes a platform: so
 * the rule is a test, not something only a running window demonstrates.
 */
export function documentFromLink(
  link: string,
  library: string,
  looksLikeDocument: (path: string) => boolean,
  exists: (path: string) => boolean,
): string | null {
  const name = workspaceTarget(link, "canvas");
  if (name === null || !looksLikeDocument(name)) return null;
  const candidate = join(library, name);
  return exists(candidate) ? candidate : null;
}

/**
 * The document a command line names: a path from the desktop, or a link the hub routed here.
 *
 * The link is read first and never falls through to the path test. A link ends in `.canvas` too, and
 * treating one as a path is how the shell tries to open a file called `suite:` — which is exactly the
 * bug this ordering exists to prevent.
 */
export function documentFromArgv(
  argv: readonly string[],
  library: string,
  looksLikeDocument: (path: string) => boolean,
  exists: (path: string) => boolean,
): string | null {
  for (const argument of argv.slice(1)) {
    if (argument.startsWith("-")) continue;
    if (argument.startsWith(SUITE_PROTOCOL)) {
      const named = documentFromLink(argument, library, looksLikeDocument, exists);
      if (named !== null) return named;
      continue;
    }
    if (looksLikeDocument(argument)) return argument;
  }
  return null;
}
