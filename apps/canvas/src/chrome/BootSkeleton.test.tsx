import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BootSkeleton } from "./BootSkeleton";

describe("BootSkeleton", () => {
  it("should announce that the local workspace is opening", () => {
    render(<BootSkeleton />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAttribute("aria-label", "Opening your workspace");
    expect(screen.getByText("Opening your workspace…")).toBeInTheDocument();
  });

  it("should not mount the canvas or a card editor", () => {
    render(<BootSkeleton />);

    expect(screen.queryByTestId("canvas-board")).toBeNull();
    expect(screen.queryByTestId("node-card")).toBeNull();
  });
});

it("should mark the exit frame before it unmounts", () => {
  render(<BootSkeleton exiting />);
  expect(screen.getByTestId("boot-skeleton")).toHaveAttribute("data-exiting", "true");
});
