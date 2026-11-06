import { beforeEach, describe, expect, it } from "vitest";
import { readSuiteSyncConfig } from "./config";

const workspaceId = "a".repeat(64);
const memberId = "b".repeat(64);
const url = "ws://127.0.0.1:8787/sync";

beforeEach(() => {
  window.sessionStorage.clear();
});

function search(entries: Record<string, string>): string {
  return `?${new URLSearchParams(entries).toString()}`;
}

describe("readSuiteSyncConfig", () => {
  it("returns null when no sync parameter is present", () => {
    expect(readSuiteSyncConfig(workspaceId, "?workspace=abc")).toBeNull();
  });

  it("reads a valid configuration and defaults the device to the member", () => {
    const read = readSuiteSyncConfig(
      null,
      search({ syncUrl: url, member: memberId, syncWorkspace: workspaceId, epoch: "2" }),
    );
    expect(read).toEqual({
      ok: true,
      value: {
        url,
        workspaceId,
        memberId,
        deviceId: memberId,
        epoch: 2,
      },
    });
  });

  it("uses the session workspace id when syncWorkspace is absent", () => {
    const read = readSuiteSyncConfig(workspaceId, search({ syncUrl: url, member: memberId }));
    expect(read).toMatchObject({ ok: true, value: { workspaceId, epoch: 1 } });
  });

  it("refuses a bad URL", () => {
    const read = readSuiteSyncConfig(
      workspaceId,
      search({ syncUrl: "https://x", member: memberId }),
    );
    expect(read).toMatchObject({ ok: false, error: expect.stringContaining("ws://") });
  });

  it("refuses a bad member or workspace", () => {
    expect(
      readSuiteSyncConfig(workspaceId, search({ syncUrl: url, member: "nope" })),
    ).toMatchObject({ ok: false, error: expect.stringContaining("member") });
    expect(
      readSuiteSyncConfig("not-a-fingerprint", search({ syncUrl: url, member: memberId })),
    ).toMatchObject({ ok: false, error: expect.stringContaining("syncWorkspace") });
  });

  it("remembers the config after the app rewrites the URL", () => {
    expect(
      readSuiteSyncConfig(
        workspaceId,
        search({ syncUrl: url, member: memberId, syncWorkspace: workspaceId }),
      ),
    ).toMatchObject({ ok: true });

    expect(readSuiteSyncConfig(workspaceId, "?workspace=x&board=board-1")).toMatchObject({
      ok: true,
      value: { url, workspaceId, memberId },
    });
  });

  it("refuses a bad epoch", () => {
    expect(
      readSuiteSyncConfig(workspaceId, search({ syncUrl: url, member: memberId, epoch: "0" })),
    ).toMatchObject({ ok: false, error: expect.stringContaining("epoch") });
  });
});
