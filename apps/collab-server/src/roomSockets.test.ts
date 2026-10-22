import type { SimpleServer } from "loro-websocket/server";
import { describe, expect, it, vi } from "vitest";
import { disconnectRooms } from "./roomSockets.js";

function fakeServer(rooms: string[]) {
  const socket = { readyState: 1, close: vi.fn() };
  const clients = new WeakMap([[socket, { rooms: new Set(rooms) }]]);
  const server = {
    wss: { clients: new Set([socket]) },
    clients,
  } as unknown as SimpleServer;
  return { server, socket };
}

describe("disconnectRooms", () => {
  it("closes a socket joined to the given room", () => {
    const { server, socket } = fakeServer(["ws-1:loro", "ws-1:presence"]);
    expect(disconnectRooms(server, ["ws-1"])).toBe(1);
    expect(socket.close).toHaveBeenCalledWith(1008, "Access revoked");
  });

  it("leaves unrelated rooms connected", () => {
    const { server, socket } = fakeServer(["ws-2:loro"]);
    expect(disconnectRooms(server, ["ws-1"])).toBe(0);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("leaves the source worker socket alone", () => {
    const { server, socket } = fakeServer(["ws-1:loro"]);
    expect(disconnectRooms(server, ["ws-1"])).toBe(0);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("leaves the multi-room projection worker alone", () => {
    const { server, socket } = fakeServer(["share-a:loro", "share-a:presence", "share-b:loro"]);
    expect(disconnectRooms(server, ["share-a"])).toBe(0);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("treats a missing runtime map as nothing to close", () => {
    expect(disconnectRooms({} as SimpleServer, ["ws-1"])).toBe(0);
  });
});
