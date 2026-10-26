import { beforeEach, describe, expect, it } from "vitest";
import { resetAnnouncerForTests, useAnnouncerStore } from "./announcer";
import { DEFAULT_TIMEOUTS, MAX_TOASTS, toast, useToastStore } from "./toast";

beforeEach(() => {
  useToastStore.getState().clear();
  resetAnnouncerForTests();
});

describe("toast", () => {
  it("should carry the tone, the detail and the tone's lifetime", () => {
    toast.success("Card deleted", { detail: "Undo with Cmd Z" });

    const [only] = useToastStore.getState().toasts;
    expect(only).toMatchObject({
      tone: "success",
      message: "Card deleted",
      detail: "Undo with Cmd Z",
      timeout: DEFAULT_TIMEOUTS.success,
      urgent: false,
      action: null,
    });
  });

  it("should keep a toast on screen until it is dismissed when timeout is null", () => {
    toast.neutral("Exporting…", { timeout: null });

    expect(useToastStore.getState().toasts[0]?.timeout).toBeNull();
  });

  it("should merge a repeat of the same sentence instead of stacking it", () => {
    toast.failure("This device is out of storage", { detail: "first" });
    toast.failure("This device is out of storage", { detail: "second" });

    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.detail).toBe("second");
    // The second attempt was not news, so it is not announced a second time.
    expect(useAnnouncerStore.getState().polite?.message).toBe(
      "This device is out of storage. first",
    );
  });

  it("should keep the newest toasts and drop the oldest past the limit", () => {
    for (let index = 0; index < MAX_TOASTS + 2; index += 1) {
      toast.neutral(`Message ${index}`);
    }

    const messages = useToastStore.getState().toasts.map((entry) => entry.message);
    expect(messages).toHaveLength(MAX_TOASTS);
    expect(messages[0]).toBe("Message 2");
    expect(messages.at(-1)).toBe(`Message ${MAX_TOASTS + 1}`);
  });

  it("should dismiss one toast and clear the rest", () => {
    const first = toast.neutral("First");
    toast.neutral("Second");

    toast.dismiss(first);
    expect(useToastStore.getState().toasts.map((entry) => entry.message)).toEqual(["Second"]);

    toast.clear();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("should raise a failure the person must act on through the assertive region", () => {
    toast.failure("This device is out of storage", { urgent: true });

    expect(useAnnouncerStore.getState().assertive?.message).toBe("This device is out of storage");
    expect(useAnnouncerStore.getState().polite).toBeNull();
  });

  it("should keep an ordinary failure polite", () => {
    toast.failure("Could not copy diagnostics");

    expect(useAnnouncerStore.getState().polite?.message).toBe("Could not copy diagnostics");
    expect(useAnnouncerStore.getState().assertive).toBeNull();
  });
});
