import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SendFeedbackBubble } from "./SendFeedbackBubble";

/**
 * The bubble asks for the words and nothing else, and it stays hidden when the
 * deployment has no desk — a form that cannot send is worse than no form.
 */
const available = () => Promise.resolve(true);

describe("the feedback bubble", () => {
  it("stays hidden when the deployment does not take feedback", async () => {
    render(<SendFeedbackBubble available={() => Promise.resolve(false)} />);
    await waitFor(() => expect(screen.queryByTestId("feedback-bubble")).toBeNull());
  });

  it("shows a bubble and opens one box", async () => {
    render(<SendFeedbackBubble available={available} send={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("feedback-bubble"));

    expect(screen.getByTestId("feedback-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-text")).toBeInTheDocument();
    // No category, no email field, no diagnostics: the message carries its own context.
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("sends the words with the surface, and closes", async () => {
    const send = vi.fn(async () => ({ ok: true as const }));
    render(<SendFeedbackBubble available={available} send={send} signedIn />);
    fireEvent.click(await screen.findByTestId("feedback-bubble"));

    fireEvent.change(screen.getByTestId("feedback-text"), {
      target: { value: "  the panel is long  " },
    });
    fireEvent.click(screen.getByTestId("feedback-send"));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        text: "the panel is long",
        surface: "board",
        signedIn: true,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("feedback-dialog")).toBeNull());
  });

  it("keeps the words and says why when the send fails", async () => {
    const send = vi.fn(async () => ({
      ok: false as const,
      reason: "rate-limited" as const,
      message: "That is a few messages already. Try again a little later.",
    }));
    render(<SendFeedbackBubble available={available} send={send} />);
    fireEvent.click(await screen.findByTestId("feedback-bubble"));
    fireEvent.change(screen.getByTestId("feedback-text"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("feedback-send"));

    await waitFor(() => expect(send).toHaveBeenCalled());
    // Still open, still holding the text: a failure must not look like a success.
    expect(screen.getByTestId("feedback-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-text")).toHaveValue("hello");
  });

  it("will not send an empty message", async () => {
    const send = vi.fn();
    render(<SendFeedbackBubble available={available} send={send} />);
    fireEvent.click(await screen.findByTestId("feedback-bubble"));

    expect(screen.getByTestId("feedback-send")).toBeDisabled();
    fireEvent.click(screen.getByTestId("feedback-send"));
    expect(send).not.toHaveBeenCalled();
  });
});
