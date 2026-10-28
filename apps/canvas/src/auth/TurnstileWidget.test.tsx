import { render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget } from "./TurnstileWidget";

/**
 * The widget's lifetime belongs to the site key alone.
 *
 * A parent that passes an inline callback used to remount the challenge on every
 * render, which on the live deployment read as "verifying", then nothing, then
 * "verifying" again, for as long as the form stayed open.
 */

type RenderOptions = { callback: (token: string) => void };
const renderWidget = vi.fn((_container: HTMLElement, _options: RenderOptions) => "widget-1");
const removeWidget = vi.fn();

beforeEach(() => {
  renderWidget.mockClear();
  removeWidget.mockClear();
  window.turnstile = { render: renderWidget, remove: removeWidget };
});

afterEach(() => {
  delete window.turnstile;
});

describe("TurnstileWidget", () => {
  it("should not re-render the challenge when the parent re-renders", async () => {
    function Host() {
      const [words, setWords] = useState("");
      return (
        <>
          <button type="button" data-testid="type" onClick={() => setWords(`${words}x`)}>
            type
          </button>
          {/* An inline arrow, which is what the bubble passed before it was fixed. */}
          <TurnstileWidget siteKey="site-key" onToken={() => setWords((value) => value)} />
        </>
      );
    }

    const { getByTestId } = render(<Host />);
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));

    getByTestId("type").click();
    getByTestId("type").click();

    expect(renderWidget).toHaveBeenCalledTimes(1);
    expect(removeWidget).not.toHaveBeenCalled();
  });

  it("should hand the token to the latest callback the parent passed", async () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = render(<TurnstileWidget siteKey="site-key" onToken={first} />);
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));

    rerender(<TurnstileWidget siteKey="site-key" onToken={second} />);

    const options = renderWidget.mock.calls[0]?.[1];
    options?.callback("token-from-cloudflare");

    expect(second).toHaveBeenCalledWith("token-from-cloudflare");
    expect(first).not.toHaveBeenCalled();
    // The challenge itself was never replaced: only the ref moved.
    expect(renderWidget).toHaveBeenCalledTimes(1);
    expect(removeWidget).not.toHaveBeenCalled();
  });

  it("should pass the size and appearance it was asked for", async () => {
    render(
      <TurnstileWidget
        siteKey="site-key"
        onToken={vi.fn()}
        size="compact"
        appearance="interaction-only"
      />,
    );
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));

    const options = renderWidget.mock.calls[0]?.[1] as {
      size?: string;
      appearance?: string;
    };
    expect(options.size).toBe("compact");
    expect(options.appearance).toBe("interaction-only");
  });

  it("should still build a fresh challenge for a different site key", async () => {
    const { rerender } = render(<TurnstileWidget siteKey="one" onToken={vi.fn()} />);
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));

    rerender(<TurnstileWidget siteKey="two" onToken={vi.fn()} />);

    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));
    expect(removeWidget).toHaveBeenCalledWith("widget-1");
  });
});
