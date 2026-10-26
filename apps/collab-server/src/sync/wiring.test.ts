import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `server.ts` is the one file no test can import: importing it opens sockets and
 * databases. That made it the hiding place for a whole class of bug — a hook the
 * handler defines and accepts, which the entry point simply forgets to pass.
 *
 * Three shipped bugs were exactly this: `onDeleted` was never wired, so a deleted
 * workspace was rewritten by its live room seconds later; `/api/admin/status`
 * never emitted `rssBytes`; and the same status reported socket rooms it cannot
 * enumerate instead of the projections that exist.
 *
 * A source scan is crude, but it is the only affordable guard for wiring, and a
 * false failure here is loud and trivially fixed. It asserts presence, not
 * behaviour: the behaviour is covered by each handler's own tests.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "server.ts"), "utf8");

/**
 * The text of one `handle*Request(...)` call, so a hook is checked against its
 * own call rather than anywhere in the file.
 *
 * A window rather than a parsed range: the dependency objects contain nested
 * callbacks, so brace matching here would be more fragile than the thing it
 * guards. Every call site is well under this size.
 */
const CALL_WINDOW = 1_600;

function callSite(name: string): string {
  const start = SOURCE.indexOf(`${name}(`);
  expect(start, `${name} is no longer called from server.ts`).toBeGreaterThan(-1);
  return SOURCE.slice(start, start + CALL_WINDOW);
}

describe("server wiring", () => {
  it("passes the hooks the workspace handler defines", () => {
    const call = callSite("handleWorkspaceRequest");
    // Without `onDeleted` the live room saves the document back after a delete.
    expect(call, "workspace delete must reach the host").toContain("onDeleted:");
    expect(call, "owner rotation must drop old sessions").toContain("onRotated:");
  });

  it("passes the deps the admin handler defines", () => {
    const call = callSite("handleAdminRequest");
    // Without `rssBytes` the status screen prints 0 for memory forever.
    expect(call, "status must report memory").toContain("rssBytes:");
    // Without `projectionRooms` status says zero rooms while hundreds are live.
    expect(call, "status must report projection rooms").toContain("projectionRooms:");
  });

  it("passes the draft actions the share handler defines", () => {
    const call = callSite("handleShareRequest");
    for (const hook of ["publish:", "reload:", "status:", "onShareRemoved:"]) {
      expect(call, `share API needs ${hook}`).toContain(hook);
    }
  });

  it("keeps the sweep and disconnect seams reachable from the operator API", () => {
    const call = callSite("handleAdminRequest");
    expect(call).toContain("sweepRooms:");
    expect(call).toContain("disconnectRoom:");
  });
});
