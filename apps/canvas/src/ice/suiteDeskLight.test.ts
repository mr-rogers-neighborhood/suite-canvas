import { describe, expect, it } from "vitest";
import { applySuiteDeskLight, SUITE_GOBO_OFF } from "./suiteDeskLight";

function fakeDesk() {
  const calls: { gobo: { opacity: number } }[] = [];
  return { calls, desk: { configureMat: (mat: { gobo: { opacity: number } }) => calls.push(mat) } };
}

describe("suiteDeskLight", () => {
  it("should switch the gobo off in exactly one call", () => {
    const { calls, desk } = fakeDesk();

    applySuiteDeskLight(desk);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.gobo.opacity).toBe(0);
    expect(calls[0]).toEqual(SUITE_GOBO_OFF);
  });

  it("should not call the desk again on a second pass", () => {
    const { calls, desk } = fakeDesk();

    applySuiteDeskLight(desk);
    applySuiteDeskLight(desk);

    expect(calls).toHaveLength(1);
  });

  it("should switch each desk handle off once", () => {
    const first = fakeDesk();
    const second = fakeDesk();

    applySuiteDeskLight(first.desk);
    applySuiteDeskLight(second.desk);

    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
  });
});
