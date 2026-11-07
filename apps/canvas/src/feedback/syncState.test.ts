import { describe, expect, it } from "vitest";
import { refusalSentence, syncPresentation } from "./syncState";

describe("what the status control says", () => {
  it("says the workspace is local when nothing has been shared", () => {
    const { situation, label, sentence } = syncPresentation({ state: null, people: 1 });
    expect(situation).toBe("local");
    expect(label).toBe("Local only");
    expect(sentence).toContain("on this device");
  });

  it("counts the other devices rather than this one", () => {
    const alone = syncPresentation({ state: { state: "syncing", count: 2 }, people: 1 });
    expect(alone.sentence).toContain("the machine it is shared with");

    const withOne = syncPresentation({ state: { state: "syncing", count: 2 }, people: 2 });
    expect(withOne.sentence).toContain("one other device");

    const withMore = syncPresentation({ state: { state: "syncing", count: 2 }, people: 4 });
    expect(withMore.sentence).toContain("3 other devices");
  });

  it("says a device waiting to be let in is still waiting", () => {
    const { situation, label, sentence } = syncPresentation({
      state: { state: "waiting" },
      people: 0,
    });
    expect(situation).toBe("waiting");
    expect(label).toBe("Waiting");
    expect(sentence).toContain("let this device in");
  });

  it("calls the other machine asleep rather than offline", () => {
    const { situation, label } = syncPresentation({
      state: { state: "asleep", reason: "the host is not answering" },
      people: 2,
    });
    expect(situation).toBe("asleep");
    expect(label).toBe("Host asleep");
  });

  it("turns the host's refusal codes into a next step", () => {
    // The codes are ours; the sentence has to say what a person would do about it.
    for (const reason of ["invite-spent", "unknown-invite", "expired"]) {
      expect(refusalSentence(reason)).toContain("Ask for a new one");
    }
    expect(refusalSentence("not-authorized")).toContain("not allowed");
    expect(refusalSentence("stale-epoch")).toContain("behind the others");
    expect(refusalSentence("something-nobody-has-seen")).toContain("still saved here");
  });

  it("never repeats a protocol word back to the reader", () => {
    const words = ["frame", "epoch", "key package", "relay", "mls", "host is"];
    for (const state of [
      { state: "off" },
      { state: "connecting" },
      { state: "waiting" },
      { state: "syncing", count: 1 },
      { state: "asleep", reason: "x" },
      { state: "refused", reason: "not-authorized" },
    ] as const) {
      const { label, sentence } = syncPresentation({ state, people: 2 });
      const said = `${label} ${sentence}`.toLowerCase();
      for (const word of words) expect(said).not.toContain(word);
    }
  });
});
