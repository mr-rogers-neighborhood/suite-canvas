import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AlphaNotice } from "./AlphaNotice";
import { forgetAlphaNotice } from "./alphaNotice";

/**
 * The notice is the only place the alpha status is unavoidable, so it has to state what
 * "alpha" means here and then get out of the way.
 */
afterEach(() => {
  cleanup();
  forgetAlphaNotice();
});

describe("the alpha notice", () => {
  it("says what alpha means here: tested behaviour, not a shared understanding", () => {
    render(<AlphaNotice forceOpen />);

    const notice = screen.getByTestId("alpha-notice");
    expect(notice).toHaveTextContent("Suite Is Alpha Software");
    // The expensive discovery, in the maintainers' own words: export rather than trust.
    expect(notice).toHaveTextContent("do not store data you cannot afford to lose");
    expect(notice).toHaveTextContent("expect bugs");
    expect(notice).toHaveTextContent("Obsidian import is experimental");
  });

  it("names the condition for leaving alpha, so the claim can be checked later", () => {
    render(<AlphaNotice forceOpen />);

    // Not "when the features are done": the bar is the gap between what tests pin down and
    // what a person can reason about.
    expect(screen.getByTestId("alpha-notice")).toHaveTextContent(
      "the gap between what the tests pin down and what a human can reason about",
    );
  });

  it("sells nothing, because there is no account to sell from", () => {
    render(<AlphaNotice forceOpen />);

    const notice = screen.getByTestId("alpha-notice");
    expect(notice).not.toHaveTextContent("subscription");
    expect(notice).not.toHaveTextContent("storage limits");
    expect(notice).not.toHaveTextContent("discount code");
  });

  it("links to the source, opened away from the app", () => {
    render(<AlphaNotice forceOpen />);

    const links = screen.getAllByTestId(/alpha-notice-(github|repository)/u);
    expect(links).toHaveLength(1);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\/github\.com\//u);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer");
    }
  });

  it("stays away once it has been read", () => {
    const first = render(<AlphaNotice />);
    fireEvent.click(screen.getByTestId("alpha-notice-dismiss"));
    expect(screen.queryByTestId("alpha-notice")).toBeNull();
    first.unmount();

    render(<AlphaNotice />);
    expect(screen.queryByTestId("alpha-notice")).toBeNull();
  });

  it("offers one way out, and no plan button, because there is nothing to sell", () => {
    // The copy stopped selling plans; the affordance went with it, so the prop did too.
    render(<AlphaNotice forceOpen />);

    expect(screen.queryByTestId("alpha-notice-plans")).toBeNull();
    expect(screen.getByTestId("alpha-notice-dismiss")).toBeInTheDocument();
  });
});
