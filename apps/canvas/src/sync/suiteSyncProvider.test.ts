import { encodeSyncMessage, type SyncMessage } from "@suite/sync";
import type { MessageEventLike, WebSocketConstructor, WebSocketLike } from "@suite/sync/loro";
import { LoroDoc } from "loro-crdt";
import { beforeEach, describe, expect, it } from "vitest";
import { SuiteSyncProvider } from "./suiteSyncProvider";

const workspaceId = "a".repeat(64);
const memberId = "b".repeat(64);

class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: MessageEventLike) => void)[]>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  addEventListener(type: string, listener: (event: MessageEventLike) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  receive(message: SyncMessage): void {
    this.emit("message", { data: encodeSyncMessage(message) });
  }

  private emit(type: string, event: MessageEventLike): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const sockets: FakeSocket[] = [];

function fakeWebSocket(): WebSocketConstructor {
  return function (this: unknown, _url: string) {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  } as unknown as WebSocketConstructor;
}

beforeEach(() => {
  sockets.length = 0;
});

describe("SuiteSyncProvider", () => {
  it("connects through the client and reports the mapped status", async () => {
    const statuses: string[] = [];
    const provider = new SuiteSyncProvider({
      url: "ws://test/sync",
      workspaceId,
      memberId,
      deviceId: memberId,
      epoch: 1,
      doc: new LoroDoc(),
      webSocket: fakeWebSocket(),
      onStatus: (status) => statuses.push(status),
    });

    sockets[0]?.open();
    await Promise.resolve();
    sockets[0]?.receive({ type: "ack", epoch: 1, versionVector: {} });

    expect(provider.status).toBe("connected");
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("connected");
    provider.dispose();
  });

  it("disposes the client", () => {
    const provider = new SuiteSyncProvider({
      url: "ws://test/sync",
      workspaceId,
      memberId,
      deviceId: memberId,
      epoch: 1,
      doc: new LoroDoc(),
      webSocket: fakeWebSocket(),
    });

    provider.dispose();
    expect(provider.status).toBe("disconnected");
  });
});
