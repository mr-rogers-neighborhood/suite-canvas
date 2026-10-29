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
    expect(notice).toHaveTextContent("public within about two weeks");
    expect(notice).toHaveTextContent("run it yourself");
    // The expensive discovery: a workspace nobody claimed is in this browser only.
    expect(notice).toHaveTextContent("lives in this browser");
    expect(notice).toHaveTextContent("Export is always available");
  });

  it("says a card is never asked for while the total is zero", () => {
    render(<AlphaNotice forceOpen />);

    expect(screen.getByTestId("alpha-notice")).toHaveTextContent("no card is asked for");
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
