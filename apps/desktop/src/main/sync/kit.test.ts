import { createDeviceIdentity, createWorkspaceGroup } from "@suite/sync";
import { describe, expect, it } from "vitest";
import { exportKit, importKit } from "./kit.js";

const workspaceId = "a".repeat(64);
const identity = {
  version: 1 as const,
  publicKey: Buffer.alloc(32, 7).toString("base64"),
  privateKey: Buffer.alloc(48, 9).toString("base64"),
};

async function group() {
  return createWorkspaceGroup(workspaceId, await createDeviceIdentity("b".repeat(64)));
}

function options(groupState: Awaited<ReturnType<typeof group>>) {
  return {
    workspaceId,
    deviceId: "c".repeat(64),
    deviceName: "Canvas on laptop",
    group: groupState,
    identity,
    now: new Date("2026-11-06T12:00:00.000Z"),
  };
}

describe("a way back in", () => {
  it("round trips a plain kit, and says who it belongs to", async () => {
    const kit = exportKit(options(await group()), null);
    const opened = importKit(kit, null);

    expect(opened.workspaceId).toBe(workspaceId);
    expect(opened.deviceId).toBe("c".repeat(64));
    expect(opened.deviceName).toBe("Canvas on laptop");
    expect(opened.identity.publicKey).toBe(identity.publicKey);
    expect(opened.group.epoch).toBe(0);
  });

  it("writes nothing a person could read when it is sealed", async () => {
    const kit = exportKit(options(await group()), "correct horse");
    const text = Buffer.from(kit).toString("utf8");

    // The point of sealing: the device's private key must not be sitting in the file.
    expect(text).not.toContain(identity.privateKey);
    expect(text).toContain("suite.recovery-kit");
    expect(text).toContain("ciphertext");
  });

  it("opens a sealed kit with its passphrase", async () => {
    const kit = exportKit(options(await group()), "correct horse");
    const opened = importKit(kit, "correct horse");
    expect(opened.identity.privateKey).toBe(identity.privateKey);
  });

  it("refuses a sealed kit with the wrong passphrase, in words", async () => {
    const kit = exportKit(options(await group()), "correct horse");
    expect(() => importKit(kit, "wrong horse")).toThrow(/passphrase did not open it/);
  });

  it("asks for the passphrase when it is sealed and none was given", async () => {
    const kit = exportKit(options(await group()), "correct horse");
    expect(() => importKit(kit, null)).toThrow(/needs its passphrase/);
  });

  it("refuses a file that is not a kit", () => {
    expect(() => importKit(new TextEncoder().encode("{}"), null)).toThrow(/not a recovery file/);
    expect(() => importKit(new TextEncoder().encode("not json"), null)).toThrow(
      /not a recovery file/,
    );
  });

  it("refuses a kit written by a newer app rather than guessing", async () => {
    const kit = JSON.parse(Buffer.from(exportKit(options(await group()), null)).toString("utf8"));
    const future = new TextEncoder().encode(JSON.stringify({ ...kit, version: 99 }));
    expect(() => importKit(future, null)).toThrow(/newer version/);
  });
});
