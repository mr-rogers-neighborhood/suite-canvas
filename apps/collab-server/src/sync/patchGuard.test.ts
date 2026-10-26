import { SimpleServer } from "loro-websocket/server";
import { describe, expect, it } from "vitest";

/**
 * The relay's live revoke depends on two methods that exist only because of
 * `patches/loro-websocket@0.6.2.patch`: without them, revoking a share link or
 * rotating an owner key stops *new* joins but leaves every open socket
 * connected, which is a security hole wearing the costume of a working feature.
 *
 * TypeScript already guards the happy path — `roomSockets.ts` takes
 * `Pick<SimpleServer, "disconnectRoomWhere" | "disconnectAuth">`, so a version
 * bump that drops the patch fails `pnpm typecheck`. This adds the runtime half:
 * the types come from the patched `.d.ts` and the behaviour from the patched
 * `dist`, and a check that only proves one of the two is a check that can pass
 * while the feature is broken.
 *
 * Failures here are not a code bug. They mean the dependency moved: pin the new
 * version in the package's `package.json`, regenerate the patch against its
 * `dist`, and update `patchedDependencies` in `pnpm-workspace.yaml`.
 */
describe("loro-websocket patch", () => {
  it("exposes the disconnect API the relay's revoke path calls", () => {
    const prototype = SimpleServer.prototype as unknown as Record<string, unknown>;
    expect(
      typeof prototype.disconnectRoomWhere,
      "patches/loro-websocket@0.6.2.patch added disconnectRoomWhere; it is missing",
    ).toBe("function");
    expect(
      typeof prototype.disconnectAuth,
      "patches/loro-websocket@0.6.2.patch added disconnectAuth; it is missing",
    ).toBe("function");
  });
});
