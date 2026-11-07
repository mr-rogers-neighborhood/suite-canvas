import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDevice,
  createDeviceIdentity,
  createWorkspaceGroup,
  decodeKeyPackageBytes,
  encodeBase64,
  encodeKeyPackageBytes,
  joinWorkspaceGroup,
  type RelayWebSocket,
  seal,
} from "@suite/sync";
import { describe, expect, it } from "vitest";
import { loadGroup, saveGroup } from "./groupStore.js";
import { loadOrCreateIdentity } from "./identity.js";
import { createSyncService, type SyncStatus } from "./service.js";

const workspaceId = "a".repeat(64);

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "suite-canvas-sync-"));
}

/** A socket the test drives as the host would. */
function fakeHost() {
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, (event?: { data: unknown }) => void>();
  let opened = false;
  const socket = {
    send: (data: string) => sent.push(JSON.parse(data) as Record<string, unknown>),
    close: () => listeners.get("close")?.(),
    addEventListener: (type: string, listener: (event?: { data: unknown }) => void) => {
      listeners.set(type, listener);
      // A real socket can open before whoever asked has finished registering its interest;
      // the connection is made asynchronously here too, so the same has to be possible.
      if (type === "open" && opened) queueMicrotask(() => listener());
    },
  } as unknown as RelayWebSocket;

  return {
    socket,
    sent,
    open: () => {
      opened = true;
      listeners.get("open")?.();
    },
    host: (message: unknown) => listeners.get("message")?.({ data: JSON.stringify(message) }),
  };
}

describe("the identity this install keeps", () => {
  it("is made once and stays the same", async () => {
    const dataDir = await folder();
    const first = await loadOrCreateIdentity(dataDir);
    const second = await loadOrCreateIdentity(dataDir);

    expect(second.publicKey).toBe(first.publicKey);
    expect(second.deviceId).toBe(first.deviceId);
    expect(first.deviceId).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("signs what it is given, verifiably", async () => {
    const dataDir = await folder();
    const identity = await loadOrCreateIdentity(dataDir);
    const signature = identity.sign(new Uint8Array([1, 2, 3]));
    expect(signature.length).toBeGreaterThan(0);
    expect(signature).not.toBe(identity.sign(new Uint8Array([1, 2, 4])));
  });
});

describe("the group it keeps", () => {
  it("round-trips through disk", async () => {
    const dataDir = await folder();
    const identity = await createDeviceIdentity("canvas-laptop");
    const group = await createWorkspaceGroup(workspaceId, identity);
    await saveGroup(dataDir, workspaceId, group);

    const loaded = await loadGroup(dataDir, workspaceId);
    expect(loaded?.epoch).toBe(group.epoch);
  });

  it("answers nothing for a workspace it never joined", async () => {
    expect(await loadGroup(await folder(), workspaceId)).toBeNull();
  });
});

describe("the service", () => {
  it("starts off, and says so", async () => {
    const service = await createSyncService({ dataDir: await folder(), workspaceId });
    expect(service.status()).toEqual({ state: "off" });
  });

  it("publishing with no host is a no-op rather than a throw", async () => {
    const service = await createSyncService({ dataDir: await folder(), workspaceId });
    await expect(service.publish(new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
  });

  it("hands a neighbour's update to the renderer", async () => {
    const dataDir = await folder();
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("this-laptop");
    const started = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(started, joiner.keyPackage);
    const joined = await joinWorkspaceGroup(added.welcome, joiner);
    await saveGroup(dataDir, workspaceId, joined);

    const fake = fakeHost();
    const service = await createSyncService({
      dataDir,
      workspaceId,
      webSocket: () => fake.socket,
    });

    const updates: Uint8Array[] = [];
    const statuses: SyncStatus[] = [];
    service.onUpdate((update) => updates.push(update));
    service.onStatus((status) => statuses.push(status));

    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;

    fake.host({
      type: "joined",
      protocolVersion: 2,
      workspaceId,
      newestEpoch: added.group.epoch,
      frames: 1,
      members: [{ deviceId: "b".repeat(64), name: "the other laptop", role: "editor" }],
    });

    const plaintext = '{"title":"from the other machine"}';
    const sealed = await seal(added.group, new TextEncoder().encode(plaintext));
    fake.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "application",
        workspaceId,
        deviceId: "b".repeat(64),
        epoch: sealed.group.epoch,
        payload: encodeBase64(sealed.message),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });

    // The frame is decrypted by whichever microtask finishes first; give it one.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(updates).toHaveLength(1);
    expect(new TextDecoder().decode(updates[0])).toBe(plaintext);
    expect(statuses.at(-1)).toMatchObject({ state: "syncing" });
    // The host said who else is here, and the service keeps it for the dialog to draw.
    expect(service.members()).toEqual([
      { deviceId: "b".repeat(64), name: "the other laptop", role: "editor" },
    ]);
  });

  it("ignores a frame from an epoch it has left", async () => {
    const dataDir = await folder();
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("this-laptop");
    const started = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(started, joiner.keyPackage);
    await saveGroup(dataDir, workspaceId, added.group);

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const updates: Uint8Array[] = [];
    service.onUpdate((update) => updates.push(update));

    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;

    fake.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "application",
        workspaceId,
        deviceId: "b".repeat(64),
        epoch: 1,
        payload: "AAAA",
        signature: "s",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(updates).toHaveLength(0);
  });

  it("says the host is asleep when the socket closes", async () => {
    const dataDir = await folder();
    const service = await createSyncService({ dataDir, workspaceId });
    const statuses: SyncStatus[] = [];
    service.onStatus((status) => statuses.push(status));

    const fake = fakeHost();
    const withSocket = await createSyncService({
      dataDir,
      workspaceId,
      webSocket: () => fake.socket,
    });
    withSocket.onStatus((status) => statuses.push(status));
    const connected = withSocket.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    fake.socket.close();

    expect(statuses.at(-1)).toMatchObject({ state: "asleep" });
    void service;
  });
});

describe("sharing a workspace for the first time", () => {
  it("makes the group, claims the workspace, and can then publish", async () => {
    const dataDir = await folder();
    const fake = fakeHost();
    const service = await createSyncService({
      dataDir,
      workspaceId,
      deviceName: "this laptop",
      webSocket: () => fake.socket,
    });

    const sharing = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await sharing;
    fake.host({
      type: "joined",
      protocolVersion: 2,
      workspaceId,
      newestEpoch: null,
      frames: 0,
      members: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    // The host allows exactly one bootstrap: a self-signed owner record while it has no
    // owners. Without it every frame this device sends is refused, and every invitation it
    // writes is refused too — a workspace that says it is syncing and stores nothing.
    const claim = fake.sent.find((message) => message.type === "role")?.record as
      | { deviceId: string; role: string; seq: number; signerId: string }
      | undefined;
    expect(claim).toMatchObject({ role: "owner", seq: 0 });
    expect(claim?.signerId).toBe(claim?.deviceId);

    // And the group is real, so an edit has somewhere to go.
    fake.sent.length = 0;
    await service.publish(new TextEncoder().encode('{"title":"first"}'));
    expect(fake.sent.some((message) => message.type === "frame")).toBe(true);
    const kept = await loadGroup(dataDir, workspaceId);
    expect(kept).not.toBeNull();
  });

  it("does not claim a workspace it was let into", async () => {
    const dataDir = await folder();
    // A device that joined somebody else's workspace: a group, but no marker saying it made it.
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("this-laptop");
    const started = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(started, joiner.keyPackage);
    await saveGroup(dataDir, workspaceId, await joinWorkspaceGroup(added.welcome, joiner));

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    // A host with no owners on record is the moment a claim would be taken, and this device
    // must not take it: it was invited here, and being invited is not being in charge.
    fake.host({
      type: "joined",
      protocolVersion: 2,
      workspaceId,
      newestEpoch: null,
      frames: 0,
      members: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fake.sent.some((message) => message.type === "role")).toBe(false);
  });
});

describe("inviting someone in", () => {
  it("hands back a link a person can paste, and tells the host", async () => {
    const dataDir = await folder();
    const group = await createWorkspaceGroup(
      workspaceId,
      await createDeviceIdentity("this-laptop"),
    );
    await saveGroup(dataDir, workspaceId, group);

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;

    const link = await service.createInvite("editor");
    expect(link.startsWith("suite://join?")).toBe(true);
    expect(fake.sent.some((message) => message.type === "invite")).toBe(true);
  });

  it("refuses to write an invitation while it is not connected", async () => {
    const service = await createSyncService({ dataDir: await folder(), workspaceId });
    await expect(service.createInvite("editor")).rejects.toThrow();
  });

  it("asks to join, and says it is waiting", async () => {
    const dataDir = await folder();
    const fake = fakeHost();
    const service = await createSyncService({
      dataDir,
      workspaceId,
      deviceName: "the desktop",
      webSocket: () => fake.socket,
    });

    const joining = service.join(
      `suite://join?h=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync&w=${workspaceId}&i=${"b".repeat(64)}`,
    );
    fake.open();
    await joining;

    expect(service.status()).toEqual({ state: "waiting" });
    const keyPackage = fake.sent.find((message) => message.type === "keypackage");
    expect(keyPackage).toMatchObject({ deviceId: expect.any(String), name: "the desktop" });
  });

  it("keeps waiting across a restart, because the invitation is already spent", async () => {
    const dataDir = await folder();
    const link = `suite://join?h=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync&w=${workspaceId}&i=${"b".repeat(64)}`;

    const first = fakeHost();
    const before = await createSyncService({
      dataDir,
      workspaceId,
      deviceName: "the desktop",
      webSocket: () => first.socket,
    });
    const joining = before.join(link);
    first.open();
    await joining;
    await before.disconnect();

    // The app quits here and comes back. A new identity would be a device the host has never
    // seen holding an invitation it will not honour twice, so the one that asked is the one
    // that has to return.
    const asked = first.sent.find((message) => message.type === "keypackage") as
      | { frame: { payload: string } }
      | undefined;
    const keyPackage = decodeKeyPackageBytes(
      new Uint8Array(Buffer.from(asked?.frame.payload ?? "", "base64")),
    );
    const owner = await createDeviceIdentity("owner-laptop");
    const ownerGroup = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(ownerGroup, keyPackage);

    const second = fakeHost();
    const after = await createSyncService({
      dataDir,
      workspaceId,
      deviceName: "the desktop",
      webSocket: () => second.socket,
    });
    const resumed = after.resume();
    second.open();
    await resumed;
    expect(after.status()).toEqual({ state: "waiting" });

    second.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "welcome",
        workspaceId,
        deviceId: "e".repeat(64),
        epoch: added.group.epoch,
        payload: encodeBase64(added.welcome),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The identity that asked is the identity that opened the welcome, which is the whole
    // reason it had to survive the restart.
    expect(await loadGroup(dataDir, workspaceId)).not.toBeNull();
    expect(after.status()).toMatchObject({ state: "syncing" });
  });

  it("says why a link is no good instead of failing quietly", async () => {
    const service = await createSyncService({ dataDir: await folder(), workspaceId });
    await service.join("not a link");
    expect(service.status()).toMatchObject({ state: "refused" });
  });

  it("lets a device in when it asks, and gives it the role its invitation promised", async () => {
    const dataDir = await folder();
    const ownerIdentity = await createDeviceIdentity("this-laptop");
    await saveGroup(dataDir, workspaceId, await createWorkspaceGroup(workspaceId, ownerIdentity));

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    await service.createInvite("viewer");
    fake.sent.length = 0;

    let asked = 0;
    service.onJoinedByAnother(() => {
      asked += 1;
    });

    // The host announces the device and the invitation it spent before relaying the key
    // package. A viewer invitation must not become an editor, and the owner cannot look the
    // role up: the invitation may have been written by a different device.
    const deviceId = "c".repeat(64);
    fake.host({
      type: "waiting",
      deviceId,
      name: "the desktop",
      inviteId: "d".repeat(64),
      role: "viewer",
    });

    // A device that wants in, and the key package it is allowed to send.
    const asking = await createDeviceIdentity("the desktop");
    fake.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "keypackage",
        workspaceId,
        deviceId,
        epoch: 0,
        payload: encodeBase64(encodeKeyPackageBytes(asking.keyPackage)),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const kinds = fake.sent.map(
      (message) => (message.frame as { kind?: string } | undefined)?.kind,
    );
    expect(kinds).toContain("commit");
    expect(kinds).toContain("welcome");
    const granted = fake.sent.find((message) => message.type === "role")?.record as
      | { deviceId: string; role: string }
      | undefined;
    expect(granted).toMatchObject({ deviceId, role: "viewer" });
    // And the app was asked for a snapshot, because a new device cannot read the past.
    expect(asked).toBe(1);
  });

  it("hears the list of who is here change, not only who was here when it joined", async () => {
    const dataDir = await folder();
    await saveGroup(
      dataDir,
      workspaceId,
      await createWorkspaceGroup(workspaceId, await createDeviceIdentity("this-laptop")),
    );

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    let announced = 0;
    service.onMembers(() => {
      announced += 1;
    });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;

    fake.host({
      type: "roster",
      members: [
        { deviceId: "b".repeat(64), name: "this laptop", role: "owner" },
        { deviceId: "c".repeat(64), name: "the desktop", role: "viewer" },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(announced).toBe(1);
    expect(service.members().map((member) => member.name)).toEqual(["this laptop", "the desktop"]);
  });

  it("ignores a key package nobody announced, rather than adding the same device twice", async () => {
    const dataDir = await folder();
    const ownerIdentity = await createDeviceIdentity("this-laptop");
    await saveGroup(dataDir, workspaceId, await createWorkspaceGroup(workspaceId, ownerIdentity));

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    fake.sent.length = 0;

    // What a reconnect looks like: the log replays every key package it holds, and each of
    // those devices is already a member. Admitting them again would add a second copy of each.
    const asking = await createDeviceIdentity("the desktop");
    fake.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "keypackage",
        workspaceId,
        deviceId: "c".repeat(64),
        epoch: 0,
        payload: encodeBase64(encodeKeyPackageBytes(asking.keyPackage)),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(fake.sent.some((message) => message.type === "role")).toBe(false);
  });
});
