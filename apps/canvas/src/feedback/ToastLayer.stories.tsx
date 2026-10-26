import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { ToastLayer } from "./ToastLayer";
import { toast, useToastStore } from "./toast";

/**
 * The toast stack, seeded through its own API so the story shows exactly what a
 * caller would get. The layer is fixed to the viewport, so every story is
 * `fullscreen` and the stack sits where it sits over the board.
 */
const meta = {
  title: "Components/Feedback/ToastLayer",
  component: ToastLayer,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof ToastLayer>;

export default meta;
type Story = StoryObj<typeof meta>;

const seeded: Record<string, () => void> = {
  success: () => {
    toast.success("Card deleted", { detail: "Undo with Cmd Z" });
  },
  failure: () => {
    toast.failure("Could not copy diagnostics", {
      detail: "The clipboard was refused.",
    });
  },
  storage: () => {
    toast.failure("This device is out of storage", {
      detail:
        "This browser is out of storage, so the latest change could not be saved to this device. It is still in this tab; export a copy before closing it.",
      urgent: true,
      action: { label: "Copy diagnostics", onAction: () => {} },
    });
  },
  stack: () => {
    toast.neutral("Exporting the workspace…");
    toast.success("Diagnostics copied");
    toast.failure("Something failed", { detail: "TypeError: undefined is not a function" });
  },
};

function Seeded({ seed }: { seed: keyof typeof seeded }) {
  useEffect(() => {
    useToastStore.getState().clear();
    const setup = seeded[seed];
    if (setup) setup();
  }, [seed]);

  return <ToastLayer />;
}

/** A success is a receipt: it leaves on its own and carries no action. */
export const Success: Story = { render: () => <Seeded seed="success" /> };

/** A failure that is merely informative stays polite. */
export const Failure: Story = { render: () => <Seeded seed="failure" /> };

/** The one case that interrupts: a write refused, with the way out attached. */
export const StorageFull: Story = { render: () => <Seeded seed="storage" /> };

/** At most four are kept; the oldest leaves as the next arrives. */
export const Stack: Story = { render: () => <Seeded seed="stack" /> };
