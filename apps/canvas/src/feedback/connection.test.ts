import { describe, expect, it } from "vitest";
import { bannerStateOf } from "./connection";

describe("bannerStateOf", () => {
  it("should report an offline room with what has not been sent", () => {
    expect(bannerStateOf("disconnected", 3)).toEqual({ kind: "offline", pending: 3 });
  });

  it("should report a reconnect in progress", () => {
    expect(bannerStateOf("rejoining", 2)).toEqual({ kind: "reconnecting", pending: 2 });
  });

  /**
   * The relay answered and refused this tab's credential. Calling that offline
   * sends someone to check a connection that is working, so it keeps its own
   * state and its own sentence.
   */
  it("should keep a refused credential out of the offline state", () => {
    expect(bannerStateOf("unauthorized", 1)).toEqual({ kind: "refused", pending: 1 });
  });

  it("should stay out of the way on a first boot", () => {
    expect(bannerStateOf("connecting", 0)).toEqual({ kind: "hidden" });
  });

  it("should show nothing once the room is live unless it just came back", () => {
    expect(bannerStateOf("connected", 0)).toEqual({ kind: "hidden" });
    expect(bannerStateOf("connected", 0, true)).toEqual({ kind: "reconnected" });
  });
});
