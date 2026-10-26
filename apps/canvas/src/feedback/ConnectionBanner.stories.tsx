import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { type ConnectionStatus, useCanvasStore } from "../store/useCanvasStore";
import { ConnectionBanner } from "./ConnectionBanner";

/**
 * The banner reads the connection it is given by the store, so each story seeds
 * the status and, when it shows a count, makes that many local edits — the same
 * path a person takes while the relay is away.
 */
const meta = {
  title: "Components/Feedback/ConnectionBanner",
  component: ConnectionBanner,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  tags: ["autodocs"],
} satisfies Meta<typeof ConnectionBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

interface SeededProps {
  status: ConnectionStatus;
  pending?: number;
}

function Seeded({ status, pending = 0 }: SeededProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    useCanvasStore.setState({ status });
    setArmed(true);
  }, [status]);

  // One commit later the banner is subscribed to local commits, so these land in
  // its count instead of before it started watching.
  useEffect(() => {
    if (!armed || pending === 0) return;
    const workspace = useCanvasStore.getState().workspace;
    for (let index = 0; index < pending; index += 1) workspace.createCard();
    setArmed(false);
  }, [armed, pending]);

  return (
    <div className="feedback-rail" data-testid="feedback-rail">
      <ConnectionBanner />
    </div>
  );
}

export const Offline: Story = {
  render: () => <Seeded status="disconnected" pending={3} />,
};

export const OfflineWithNothingToSend: Story = {
  render: () => <Seeded status="disconnected" />,
};

export const Reconnecting: Story = {
  render: () => <Seeded status="rejoining" pending={2} />,
};

/**
 * The relay answered and refused this tab. It is not offline, and the banner
 * does not offer a retry that would fail the same way.
 */
export const AccessRefused: Story = {
  render: () => <Seeded status="unauthorized" pending={1} />,
};
