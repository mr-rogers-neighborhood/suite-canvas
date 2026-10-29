import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlphaNotice } from "./AlphaNotice";
import { forgetAlphaNotice } from "./alphaNotice";

/**
 * The notice is the only place the alpha status is unavoidable, so it has to state the
 * three things a new reader needs and then get out of the way: what is rough, what paying
 * buys, and that an unclaimed workspace is this browser's copy.
 */
afterEach(() => {
  cleanup();
  forgetAlphaNotice();
});

describe("the alpha notice", () => {
  it("says what an alpha is, what a plan buys, and where the work lives", () => {
    render(<AlphaNotice forceOpen />);

    const notice = screen.getByTestId("alpha-notice");
    expect(notice).toHaveTextContent("alpha software");
    expect(notice).toHaveTextContent("sync, collaboration and file uploads");
    // The source is public now, so the sentence that promised it would be is gone; the door
    // to it is a link instead, and it is checked below.
    expect(notice).not.toHaveTextContent("within about two weeks");
    expect(notice).toHaveTextContent("run it yourself");
    // The expensive discovery: a workspace nobody claimed is in this browser only.
    expect(notice).toHaveTextContent("saved in this browser");
    expect(notice).toHaveTextContent("Export is always available");
  });

  it("says where a discount code goes, since none is applied for you", () => {
    render(<AlphaNotice forceOpen />);

    const notice = screen.getByTestId("alpha-notice");
    expect(notice).toHaveTextContent("a discount code, if you have one");
    expect(notice).toHaveTextContent("cancel from the portal");
    // Paying is offered as support, not as a condition of using the product.
    expect(notice).toHaveTextContent("paying is optional");
  });

  it("links to the source, opened away from the app", () => {
    render(<AlphaNotice forceOpen />);

    const links = screen.getAllByTestId(/alpha-notice-(github|repository)/u);
    expect(links).toHaveLength(2);
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

  it("opens the plan surface and gets out of the way", () => {
    const onSeePlans = vi.fn();
    render(<AlphaNotice forceOpen onSeePlans={onSeePlans} />);

    fireEvent.click(screen.getByTestId("alpha-notice-plans"));

    expect(onSeePlans).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("alpha-notice")).toBeNull();
  });

  it("offers no plan button on a build that sells nothing", () => {
    render(<AlphaNotice forceOpen />);

    expect(screen.queryByTestId("alpha-notice-plans")).toBeNull();
    expect(screen.getByTestId("alpha-notice-dismiss")).toBeInTheDocument();
  });
});
