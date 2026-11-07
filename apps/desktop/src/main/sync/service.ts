import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  addDevice,
  applyCommit,
  createDeviceIdentity,
  createRelayClient,
  createWorkspaceGroup,
  decodeBase64,
  decodeKeyPackageBytes,
  encodeBase64,
  encodeKeyPackageBytes,
  ephemeralPayload,
  exportKey,
  type Frame,
  formatInvite,
  type InviteRecord,
  inviteRecordPayload,
  joinWorkspaceGroup,
  leafIndexOf,
  type MemberRole,
  open as openMessage,
  parseInvite,
  type RelayClient,
  type RelayClientHandlers,
  type RelayMember,
  type RelayWebSocketFactory,
  removalRecordPayload,
  removeDevice as removeDeviceFromGroup,
  roleRecordPayload,
  seal,
  signFrame,
} from "@suite/sync";
import type { SyncState } from "../../shared/ipc.js";
import { isOwned, loadGroup, markOwned, saveGroup } from "./groupStore.js";
import {
  type DeviceIdentity,
  deviceIdFrom,
  loadOrCreateIdentity,
  readStoredIdentity,
  writeStoredIdentity,
} from "./identity.js";
import { exportKit, importKit } from "./kit.js";
import { recordKit } from "./kitReport.js";
import { clearPending, loadPending, type PendingJoin, savePending } from "./pendingStore.js";

/**
 * One workspace's sync, owned by the main process.
 *
 * The document lives in the renderer and the keys live here, so this service is a pair of
 * doors: a document update comes in from the renderer and leaves as a sealed frame; a frame
 * arrives from the host and leaves as a document update. Nothing else crosses.
 *
 * It is deliberately not an Electron module. Paths and a socket factory are handed in, so
 * the whole thing can be tested without a window.
 */

/**
 * What this service is doing.
 *
 * The same shape the renderer receives, defined once in `shared/ipc.ts`: two unions that
 * describe one thing drift the first time either gains a state.
 */
export type SyncStatus = SyncState;

export interface SyncServiceOptions {
  readonly dataDir: string;
  readonly workspaceId: string;
  readonly webSocket?: RelayWebSocketFactory;
  /** What this device is called on the other person's screen. */
  readonly deviceName?: string;
}

export interface SyncService {
  /** Connect to a host this device already belongs to. */
  connect(url: string): Promise<SyncStatus>;
  disconnect(): Promise<void>;
  status(): SyncStatus;
  /** The device id and public key the host pins, for a pairing string. */
  identity(): Promise<Pick<DeviceIdentity, "deviceId" | "publicKey">>;
  /** Seal a document update from the renderer and send it. */
  publish(update: Uint8Array): Promise<void>;
  /** Write an invitation and hand back the link to give someone. */
  createInvite(role: "editor" | "viewer"): Promise<string>;
  /** Ask to join from a link somebody shared. Resolves once this device is in. */
  join(link: string): Promise<SyncStatus>;
  /**
   * Pick up a join that was still waiting when the app closed.
   *
   * Does nothing when there is nothing to wait for, so a launch can call it unconditionally.
   */
  resume(): Promise<SyncStatus>;
  /** Who is in this workspace and what each of them may do, as the host last said. */
  members(): readonly RelayMember[];
  /**
   * Send presence: a small update nobody keeps.
   *
   * Sealed with a key derived from the group rather than with the group's application
   * ciphertext, because a dropped cursor must never leave a gap the next document update has
   * to work around.
   */
  presence(update: Uint8Array): Promise<void>;
  /** Somebody else's presence, already opened. Live only. */
  onPresence(handler: (update: Uint8Array) => void): void;
  /** Take a device out of this workspace. Only an owner's record is applied. */
  removeDevice(deviceId: string): Promise<void>;
  /** Write this device's way back in, plain or sealed with a passphrase. */
  exportKit(passphrase: string | null): Promise<Uint8Array>;
  /**
   * Install a way back in.
   *
   * Refuses a file for another workspace, and refuses to overwrite an identity that belongs
   * to a different device: that file is somebody else's install.
   */
  importKit(bytes: Uint8Array, passphrase: string | null): Promise<void>;
  /** Say what this device did about its way back in, for the hub's pane to read. */
  noteKit(state: "made" | "declined", sealed: boolean): Promise<void>;
  /**
   * The list of who is here changed.
   *
   * Separate from the status on purpose: a device joining does not change what sync is doing,
   * but it does change who a person is looking at when they open the dialog.
   */
  onMembers(handler: () => void): void;
  /**
   * Somebody was let in, so the app should hand over what the workspace already contains.
   *
   * A device that joins cannot read anything sealed before it joined, so without this it
   * joins an empty board and starts a second one.
   */
  onJoinedByAnother(handler: () => void): void;
  /** Hand out document updates from other devices. */
  onUpdate(handler: (update: Uint8Array) => void): void;
  onStatus(handler: (status: SyncStatus) => void): void;
}

export async function createSyncService(options: SyncServiceOptions): Promise<SyncService> {
  // Reassigned only by a recovery file, which is the one thing that may replace it: the hub
  // pins this key, so a restored device has to answer with the key the hub already knows.
  let identity = await loadOrCreateIdentity(options.dataDir);
  /** What the other person's screen calls this device. */
  const deviceName = options.deviceName ?? "a Suite app";
  let group = await loadGroup(options.dataDir, options.workspaceId);
  let relay: RelayClient | null = null;
  let status: SyncStatus = { state: "off" };
  let updateHandler: ((update: Uint8Array) => void) | null = null;
  let statusHandler: ((status: SyncStatus) => void) | null = null;
  let joinedHandler: (() => void) | null = null;
  let membersHandler: (() => void) | null = null;
  /** The address written into a link, remembered from the last connection. */
  let hostUrl: string | null = null;
  /** Who the host says is here, refreshed on every join and on every change to a role. */
  let members: readonly RelayMember[] = [];
  let presenceHandler: ((update: Uint8Array) => void) | null = null;
  /** Set when an owner took this device out, so the socket closing is not read as a fault. */
  let removedByOwner = false;
  /** The presence key for the epoch we are in, derived once per epoch rather than per cursor. */
  let presenceKeyCache: { readonly epoch: number; readonly key: Uint8Array } | null = null;
  /**
   * A device that asked to be let in, and the role its invitation promised.
   *
   * The host announces this before it relays the key package, so letting the device in knows
   * what record to write without asking the person a question their invitation already
   * answered. An entry that is never used expires with the service.
   */
  const waitingRoles = new Map<string, MemberRole>();
  /** A join in flight: the identity whose key package is waiting for a welcome. */
  let pending: PendingJoin | null = await loadPending(options.dataDir, options.workspaceId);
  /** How many frames this device has taken from the host, for a catch-up request. */
  let received = 0;
  /** The queue that keeps frame handling in order, one at a time. */
  let frames: Promise<void> = Promise.resolve();

  const publishStatus = (next: SyncStatus): void => {
    status = next;
    statusHandler?.(next);
  };

  /** This device started this workspace's group, so it may own it if nobody does. */
  let startedHere = await isOwned(options.dataDir, options.workspaceId);

  /**
   * Claim the workspace, but only when there is nobody to claim it from.
   *
   * The host allows exactly one bootstrap: a self-signed owner record while it has no owners.
   * A device that was let into somebody else's workspace must never take that door, which is
   * why the claim needs both the marker written when this device created the group and a host
   * that has no owner on record.
   */
  function claimOwnership(): void {
    if (relay === null || !startedHere) return;
    if (members.some((member) => member.role === "owner")) return;
    const unsigned = {
      workspaceId: options.workspaceId,
      deviceId: identity.deviceId,
      role: "owner" as const,
      seq: 0,
      signerId: identity.deviceId,
    };
    relay.setRole({ ...unsigned, signature: identity.sign(roleRecordPayload(unsigned)) });
  }

  /**
   * The key presence is sealed with, for the epoch this device is in.
   *
   * Derived, not ratcheted: presence can arrive late, out of order or not at all without
   * costing anybody a document update. A device in a different epoch simply cannot open it,
   * which is the right answer for something that only describes the present.
   */
  async function presenceKey(): Promise<Uint8Array | null> {
    if (group === null) return null;
    if (presenceKeyCache !== null && presenceKeyCache.epoch === group.epoch) {
      return presenceKeyCache.key;
    }
    const key = await exportKey(group, "suite/presence", options.workspaceId);
    presenceKeyCache = { epoch: group.epoch, key };
    return key;
  }

  async function sealPresence(update: Uint8Array): Promise<string | null> {
    const key = await presenceKey();
    if (key === null) return null;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const body = Buffer.concat([cipher.update(Buffer.from(update)), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64");
  }

  async function openPresence(payload: string): Promise<Uint8Array | null> {
    const key = await presenceKey();
    const bytes = decodeBase64(payload);
    if (key === null || bytes === null || bytes.length <= 28) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
    } catch {
      // A cursor this device cannot read is not an error: it is what a device in another
      // epoch sees, by design, and there is nothing to recover or report.
      return null;
    }
  }

  const handlers: RelayClientHandlers = {
    onJoined: (info) => {
      members = info.members;
      claimOwnership();
      publishStatus({ state: "syncing", count: info.frames });
    },
    onFrame: (_index, frame) => {
      received += 1;
      // One at a time, in the order the host sent them. Applying a frame is not a pure read:
      // opening a welcome creates the group, and opening an application message ratchets the
      // secret tree. Run two at once and a snapshot that followed a welcome is evaluated before
      // the group exists — the joiner then sits in a workspace it cannot read.
      frames = frames.then(() => applyFrame(frame)).catch(() => undefined);
    },
    onWaiting: (waiting) => {
      waitingRoles.set(waiting.deviceId, waiting.role);
    },
    onRoster: (roster) => {
      members = roster.members;
      membersHandler?.();
    },
    onEphemeral: (message) => {
      void openPresence(message.payload).then((update) => {
        if (update !== null) presenceHandler?.(update);
      });
    },
    onRemoved: () => {
      removedByOwner = true;
      pending = null;
      void clearPending(options.dataDir, options.workspaceId);
      relay?.close();
      relay = null;
      publishStatus({ state: "removed" });
    },
    onRefused: (reason) => publishStatus({ state: "refused", reason }),
    onError: (code, message) => publishStatus({ state: "asleep", reason: `${code}: ${message}` }),
    onClosed: () => {
      // A socket that closes because somebody removed this device is not a host that went to
      // sleep, and saying so would offer a retry that can never work.
      if (removedByOwner) return;
      publishStatus({ state: "asleep", reason: "the host is not answering" });
    },
  };

  /**
   * Somebody asked to join, so let them in.
   *
   * The invitation already decided who and in what role, and the host has spent it by the
   * time this frame arrives. Asking the owner to confirm the same decision twice is how a
   * prompt becomes something people click past.
   */
  async function admitDevice(frame: Frame, role: MemberRole): Promise<void> {
    if (group === null || relay === null) return;

    const payload = decodeBase64(frame.payload);
    if (payload === null) return;

    const added = await addDevice(group, decodeKeyPackageBytes(payload));
    group = added.group;
    await saveGroup(options.dataDir, options.workspaceId, group);

    relay.send(
      signFrame(identity.sign, {
        kind: "commit",
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: added.group.epoch,
        payload: encodeBase64(added.commit),
      }),
    );
    relay.send(
      signFrame(identity.sign, {
        kind: "welcome",
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: added.group.epoch,
        payload: encodeBase64(added.welcome),
      }),
    );

    // The role the invitation granted. Without it the device is in the group but may not
    // write, which reads as a broken workspace rather than a missing step.
    const unsigned = {
      workspaceId: options.workspaceId,
      deviceId: frame.deviceId,
      role,
      seq: 0,
      signerId: identity.deviceId,
    };
    relay.setRole({ ...unsigned, signature: identity.sign(roleRecordPayload(unsigned)) });

    // Now the document itself: the app hands over a snapshot, which is what a device that
    // cannot read anything from before it joined actually needs.
    joinedHandler?.();
  }

  /** This device was let in, so take the welcome and become part of the group. */
  /**
   * Somebody else changed who is in the group, so move to the epoch they made.
   *
   * Without this a member is left at the epoch it joined in: it would read nothing that came
   * after an Add or a Remove and would never say so, because a frame it cannot open is not an
   * error. That is the difference between "removed" working for the person who removed and
   * working for everybody else.
   */
  async function applyCommitFromPeer(frame: Frame): Promise<void> {
    const current = group;
    if (current === null) return;
    const payload = decodeBase64(frame.payload);
    if (payload === null) return;
    try {
      const applied = await applyCommit(current, payload);
      group = applied.group;
      presenceKeyCache = null;
      await saveGroup(options.dataDir, options.workspaceId, group);
    } catch {
      // A commit this device cannot apply is one it is already past, or one for a group it is
      // no longer in. Neither is worth telling a person about.
    }
  }

  async function acceptWelcome(frame: Frame): Promise<void> {
    if (pending === null) return;
    const payload = decodeBase64(frame.payload);
    if (payload === null) return;

    try {
      group = await joinWorkspaceGroup(payload, pending.identity);
      pending = null;
      await clearPending(options.dataDir, options.workspaceId);
      await saveGroup(options.dataDir, options.workspaceId, group);
      publishStatus({ state: "syncing", count: received });
    } catch {
      publishStatus({ state: "refused", reason: "That invitation could not be used." });
    }
  }

  async function applyFrame(frame: Frame): Promise<void> {
    // A welcome is the one frame a device with no group is waiting for, so it is handled
    // before any of the epoch reasoning below — the joiner has no epoch to compare against.
    if (frame.kind === "welcome") {
      await acceptWelcome(frame);
      return;
    }

    // A frame for an epoch this device has left is not late, it is irrelevant; MLS would
    // quietly decrypt it as an old application message rather than refuse it.
    if (group === null || frame.epoch < group.epoch) return;

    if (frame.kind === "commit") {
      await applyCommitFromPeer(frame);
      return;
    }

    if (frame.kind === "keypackage") {
      // Only a device the host has just announced, and only once. A key package replayed from
      // the log on connect is a device that is already a member, so adding it again would put
      // a second copy in the tree and a second join on everyone's screen.
      const role = waitingRoles.get(frame.deviceId);
      if (role === undefined) return;
      waitingRoles.delete(frame.deviceId);
      await admitDevice(frame, role);
      return;
    }

    if (frame.kind !== "application") return;

    const payload = decodeBase64(frame.payload);
    if (payload === null) return;

    try {
      const opened = await openMessage(group, payload);
      group = opened.group;
      await saveGroup(options.dataDir, options.workspaceId, group);
      const plaintext: Uint8Array | null = opened.plaintext;
      if (plaintext !== null) updateHandler?.(plaintext);
    } catch {
      // A frame this device cannot read is not an error worth surfacing: it is what a device
      // that joined later sees of the past, by design.
    }
  }

  /**
   * Turn sync on for this workspace.
   *
   * Sharing a workspace that has never been shared is where its group is made: one member,
   * this device, in the first epoch. Joining somebody else's does not come through here —
   * that group arrives inside the welcome — so this is the only place a group is created, and
   * creating it is also what makes this device the workspace's owner.
   */
  async function share(url: string): Promise<SyncStatus> {
    if (group === null) {
      group = await createWorkspaceGroup(
        options.workspaceId,
        await createDeviceIdentity(deviceName),
      );
      await saveGroup(options.dataDir, options.workspaceId, group);
      await markOwned(options.dataDir, options.workspaceId);
      startedHere = true;
    }
    return connectTo(url);
  }

  async function connectTo(url: string): Promise<SyncStatus> {
    if (relay !== null) return status;
    publishStatus({ state: "connecting" });
    hostUrl = url;
    try {
      relay = await createRelayClient(
        {
          url,
          workspaceId: options.workspaceId,
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          name: deviceName,
          sign: identity.sign,
          ...(options.webSocket === undefined ? {} : { webSocket: options.webSocket }),
        },
        handlers,
      );
      // Ask for what arrived while this device was closed, once the client exists. 0 means
      // everything the host still holds, which is the honest answer for a device that has
      // never synced. Doing it from `onJoined` looked equivalent and was not: the host can
      // answer before the client is assigned, and the catch-up was dropped on the floor.
      relay.since(received);
    } catch (error) {
      publishStatus({
        state: "asleep",
        reason: error instanceof Error ? error.message : "the host is not answering",
      });
    }
    return status;
  }

  return {
    connect: share,

    async disconnect() {
      relay?.close();
      relay = null;
      publishStatus({ state: "off" });
    },

    status: () => status,

    identity: async () => ({ deviceId: identity.deviceId, publicKey: identity.publicKey }),

    members: () => members,

    /**
     * Write an invitation and hand back the link to give someone.
     *
     * The role is decided here, by the person inviting, and travels inside the signed record
     * — so letting somebody in later does not ask the same question twice.
     */
    async createInvite(role) {
      if (relay === null || hostUrl === null) throw new Error("Sync is not connected.");
      const inviteId = randomInviteId();
      const unsigned = {
        workspaceId: options.workspaceId,
        inviteId,
        role,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        signerId: identity.deviceId,
      };
      const record: InviteRecord = {
        ...unsigned,
        signature: identity.sign(inviteRecordPayload(unsigned)),
      };
      relay.sendInvite(record);
      return formatInvite({ host: hostUrl, workspaceId: options.workspaceId, inviteId });
    },

    /**
     * Pick up a join that was still waiting when the app closed.
     *
     * The key package is already on the host and the invitation it spent is already gone, so
     * there is nothing to send: this reconnects where the device asked and waits for the
     * welcome that follows. A launch calls it without knowing whether there is anything to
     * resume.
     */
    async resume() {
      if (pending === null || relay !== null) return status;
      await connectTo(pending.host);
      if (relay === null) return status;
      publishStatus({ state: "waiting" });
      return status;
    },

    /**
     * Ask to join from a link somebody shared.
     *
     * The identity behind the request has to be held until the welcome comes back — it is the
     * only thing that can open it — so it goes on disk the moment it is made. An invitation is
     * spent when the host stores this key package, so quitting between here and the welcome
     * would otherwise leave the other person adding a device that never appears.
     */
    async join(link) {
      const parsed = parseInvite(link);
      if (!parsed.ok) {
        publishStatus({ state: "refused", reason: parsed.reason });
        return status;
      }
      if (parsed.value.workspaceId !== options.workspaceId) {
        publishStatus({ state: "refused", reason: "That invitation is for another workspace." });
        return status;
      }

      await connectTo(parsed.value.host);
      if (relay === null) return status;

      // The group's credential is the device id, not the name: names are cosmetic and two
      // devices may share one, but removing the wrong device is not a cosmetic mistake.
      const asked = await createDeviceIdentity(identity.deviceId);
      pending = { identity: asked, host: parsed.value.host };
      await savePending(options.dataDir, options.workspaceId, asked, parsed.value.host);
      const header = {
        kind: "keypackage" as const,
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: 0,
        payload: encodeBase64(encodeKeyPackageBytes(asked.keyPackage)),
      };
      relay.sendKeyPackage({
        inviteId: parsed.value.inviteId,
        deviceId: identity.deviceId,
        publicKey: identity.publicKey,
        name: deviceName,
        frame: signFrame(identity.sign, header),
      });
      publishStatus({ state: "waiting" });
      return status;
    },

    onJoinedByAnother(handler) {
      joinedHandler = handler;
    },

    onMembers(handler) {
      membersHandler = handler;
    },

    async presence(update) {
      if (relay === null || group === null) return;
      const payload = await sealPresence(update);
      if (payload === null) return;
      const body = {
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        payload,
      };
      relay.sendEphemeral({ ...body, signature: identity.sign(ephemeralPayload(body)) });
    },

    onPresence(handler) {
      presenceHandler = handler;
    },

    /**
     * Take a device out.
     *
     * Two halves of one decision: the commitment that removes it from the group, which only
     * members can read, and the record the host can read so it stops carrying that device's
     * mail. The group moves to a new epoch, so everything sealed afterwards is unreadable to
     * the device that left — which is the whole of what "removed" can honestly mean.
     */
    async removeDevice(deviceId) {
      if (group === null || relay === null) throw new Error("This workspace is not shared yet.");
      const name = members.find((member) => member.deviceId === deviceId)?.name;
      // The device id first, because that is what a credential is now; the name is the fallback
      // for a group made before that was true, so an older workspace can still be tidied up.
      const leaf =
        leafIndexOf(group, deviceId) ?? (name === undefined ? null : leafIndexOf(group, name));
      if (leaf === null) throw new Error("That device is not in this workspace.");

      const removed = await removeDeviceFromGroup(group, leaf);
      group = removed.group;
      presenceKeyCache = null;
      await saveGroup(options.dataDir, options.workspaceId, group);
      relay.send(
        signFrame(identity.sign, {
          kind: "commit",
          workspaceId: options.workspaceId,
          deviceId: identity.deviceId,
          epoch: group.epoch,
          payload: encodeBase64(removed.commit),
        }),
      );

      const unsigned = {
        workspaceId: options.workspaceId,
        deviceId,
        removedAt: new Date().toISOString(),
        signerId: identity.deviceId,
      };
      relay.sendRemoval({
        ...unsigned,
        signature: identity.sign(removalRecordPayload(unsigned)),
      });
    },

    async exportKit(passphrase) {
      const stored = await readStoredIdentity(options.dataDir);
      if (group === null) throw new Error("This workspace is not shared yet.");
      if (stored === null) throw new Error("This device has no identity to save.");

      return exportKit(
        {
          workspaceId: options.workspaceId,
          deviceId: identity.deviceId,
          deviceName,
          group,
          identity: stored,
        },
        passphrase,
      );
    },

    async noteKit(state, sealed) {
      await recordKit(options.dataDir, {
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        state,
        sealed,
      });
    },

    async importKit(bytes, passphrase) {
      const opened = importKit(bytes, passphrase);
      if (opened.workspaceId !== options.workspaceId) {
        throw new Error("That recovery file is for another workspace.");
      }
      if (deviceIdFrom(opened.identity.publicKey) !== opened.deviceId) {
        throw new Error("That recovery file does not match the device it names.");
      }
      // Only an install that has never joined anything may take a recovered device's place.
      // Anything else would be two machines answering to one id, which the hub refuses anyway.
      if (group !== null || pending !== null || startedHere) {
        throw new Error("This device is already set up for this workspace.");
      }

      identity = await writeStoredIdentity(options.dataDir, opened.identity, true);
      group = opened.group;
      presenceKeyCache = null;
      await saveGroup(options.dataDir, options.workspaceId, group);
      // The file exists, which is what the hub reports; the device is not connected until
      // somebody connects it, and saying "syncing" before that would be a claim with no basis.
      await recordKit(options.dataDir, {
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        state: "made",
        sealed: (passphrase ?? "").trim().length > 0,
      });
    },

    async publish(update) {
      if (relay === null || group === null) return;
      const sealed = await seal(group, update);
      group = sealed.group;
      await saveGroup(options.dataDir, options.workspaceId, group);

      const header = {
        kind: "application" as const,
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: sealed.group.epoch,
        payload: encodeBase64(sealed.message),
      };
      relay.send(signFrame(identity.sign, header));
    },

    onUpdate(handler) {
      updateHandler = handler;
    },

    onStatus(handler) {
      statusHandler = handler;
    },
  };
}

/** The key a workspace's attachments and derived names would use. Nothing uses it yet. */
export async function workspaceKey(
  service: SyncService,
  workspaceId: string,
  dataDir: string,
): Promise<Uint8Array | null> {
  const group = await loadGroup(dataDir, workspaceId);
  if (group === null) return null;
  void service;
  return exportKey(group, "suite/workspace-key", workspaceId);
}

/** An invite id is 32 random bytes, written the way every other id in the protocol is. */
function randomInviteId(): string {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
