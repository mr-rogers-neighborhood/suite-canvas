import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDevice,
  createDeviceIdentity,
  createWorkspaceGroup,
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
  const socket = {
    send: (data: string) => sent.push(JSON.parse(data) as Record<string, unknown>),
    close: () => listeners.get("close")?.(),
    addEventListener: (type: string, listener: (event?: { data: unknown }) => void) =>
      listeners.set(type, listener),
  } as unknown as RelayWebSocket;

  return {
    socket,
    sent,
    open: () => listeners.get("open")?.(),
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
      protocolVersion: 1,
      workspaceId,
      newestEpoch: added.group.epoch,
      frames: 1,
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

  it("says why a link is no good instead of failing quietly", async () => {
    const service = await createSyncService({ dataDir: await folder(), workspaceId });
    await service.join("not a link");
    expect(service.status()).toMatchObject({ state: "refused" });
  });

  it("lets a device in when it asks, and gives it a role", async () => {
    const dataDir = await folder();
    const ownerIdentity = await createDeviceIdentity("this-laptop");
    await saveGroup(dataDir, workspaceId, await createWorkspaceGroup(workspaceId, ownerIdentity));

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    await service.createInvite("editor");
    fake.sent.length = 0;

    let asked = 0;
    service.onJoinedByAnother(() => {
      asked += 1;
    });

    // A device that wants in, and the key package it is allowed to send.
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

    const kinds = fake.sent.map(
      (message) => (message.frame as { kind?: string } | undefined)?.kind,
    );
    expect(kinds).toContain("commit");
    expect(kinds).toContain("welcome");
    expect(fake.sent.some((message) => message.type === "role")).toBe(true);
    // And the app was asked for a snapshot, because a new device cannot read the past.
    expect(asked).toBe(1);
  });
});
