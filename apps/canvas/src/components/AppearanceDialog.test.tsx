import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { DEFAULT_APPEARANCE } from "../theme/appearance";
import { useAppearanceStore } from "../theme/useAppearanceStore";
import { AppearanceDialog } from "./AppearanceDialog";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The appearance entry point ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)).
 *
 * What is asserted here is the *boundary*, not the paint: the theme switcher is one door
 * in, every control reaches the preference store, and a change repaints the root with an
 * attribute. Whether compact is 4px or 6px of padding is the stylesheet's business.
 */
const dialog = () => screen.queryByTestId("appearance-dialog");

beforeEach(() => {
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE });
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-canvas");
  document.documentElement.removeAttribute("data-motion");
});

afterEach(cleanup);

describe("the appearance entry point", () => {
  it("is reached from the theme switcher, which is not a settings page", () => {
    render(<ThemeToggle />);

    expect(dialog()).toBeNull();
    fireEvent.click(screen.getByTestId("theme-toggle"));
    fireEvent.click(screen.getByTestId("theme-appearance"));

    expect(dialog()).not.toBeNull();
    // The menu closes behind it: one surface at a time.
    expect(screen.queryByTestId("theme-menu")).toBeNull();
  });

  it("offers the four things a reader owns alone", () => {
    render(<AppearanceDialog onClose={() => {}} />);

    for (const control of [
      "appearance-density",
      "appearance-radius",
      "appearance-canvas",
      "appearance-motion",
    ]) {
      expect(screen.getByTestId(control), control).toBeInTheDocument();
    }
  });

  it("applies a change to the root immediately, so the canvas behind it is the preview", () => {
    render(<AppearanceDialog onClose={() => {}} />);

    fireEvent.change(screen.getByTestId("appearance-density"), { target: { value: "compact" } });
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(useAppearanceStore.getState().appearance.density).toBe("compact");

    fireEvent.change(screen.getByTestId("appearance-radius"), { target: { value: "4" } });
    expect(screen.getByTestId("appearance-radius-value")).toHaveTextContent("4px");
    expect(document.documentElement.style.getPropertyValue("--reader-card-radius")).toBe("4px");

    fireEvent.change(screen.getByTestId("appearance-motion"), { target: { value: "reduced" } });
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("resets to the defaults, and the root follows", () => {
    useAppearanceStore.setState({
      appearance: { ...DEFAULT_APPEARANCE, density: "compact", radius: 2 },
    });
    render(<AppearanceDialog onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("appearance-reset"));

    expect(useAppearanceStore.getState().appearance).toEqual(DEFAULT_APPEARANCE);
    expect(document.documentElement.dataset.density).toBe(DEFAULT_APPEARANCE.density);
  });

  it("says whose preference this is", () => {
    render(<AppearanceDialog onClose={() => {}} />);

    // The line that keeps the promise of the ADR: nothing here restyles a card for
    // anybody else.
    expect(screen.getByTestId("appearance-dialog")).toHaveTextContent(
      "These change this device only",
    );
  });

  it("closes when asked", () => {
    const onClose = vi.fn();
    render(<AppearanceDialog onClose={onClose} />);

    fireEvent.click(screen.getByTestId("appearance-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the workspace palette mirror", () => {
  it("names the scope and the roles rather than offering a second editor", () => {
    const workspace = useCanvasStore.getState().workspace;
    workspace.setWorkspaceTheme(null);
    render(<AppearanceDialog onClose={() => {}} />);

    // No palette: the built-in one, said plainly.
    expect(screen.getByTestId("appearance-workspace-theme")).toHaveTextContent("Built-in palette");
    // Nothing here writes the document — the Styles list is the one editor.
    expect(screen.queryByTestId("workspace-theme-light-surface")).toBeNull();

    workspace.setWorkspaceTheme({ light: { surface: "#fdf6e3", ink: "#201c14" }, dark: {} });
    cleanup();
    render(<AppearanceDialog onClose={() => {}} />);
    expect(screen.getByTestId("appearance-workspace-theme")).toHaveTextContent(
      "2 role(s) set here, light mode",
    );
    workspace.setWorkspaceTheme(null);
  });
});
