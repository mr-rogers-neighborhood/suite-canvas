import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleBuildNotice } from "./StaleBuildNotice";
import { useStaleBuild } from "./useStaleBuild";

/** The notice as the shell wires it: the hook decides, the component says. */
function Probe() {
  const stale = useStaleBuild();
  return stale ? <StaleBuildNotice onReload={() => {}} /> : null;
}

const served = (entry: string) => `<!doctype html><script type="module" src="${entry}"></script>`;

describe("the stale build notice", () => {
  beforeEach(() => {
    document.head.innerHTML = '<script type="module" src="/assets/main-loaded.js"></script>';
  });

  afterEach(() => {
    document.head.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("appears when the server would hand out a different entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(served("/assets/main-deployed.js"), { status: 200 })),
    );
    render(<Probe />);
    expect(await screen.findByTestId("stale-build-notice")).toBeTruthy();
    expect(screen.getByTestId("stale-build-reload").textContent).toBe("Reload");
  });

  it("stays away when the tab is already on the served build", async () => {
    const fetchMock = vi.fn(
      async () => new Response(served("/assets/main-loaded.js"), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("stale-build-notice")).toBeNull();
  });

  it("says nothing when the check cannot reach the host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(<Probe />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("stale-build-notice")).toBeNull();
  });
});
