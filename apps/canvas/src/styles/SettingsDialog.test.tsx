import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { DEFAULT_APPEARANCE } from "../theme/appearance";
import { useAppearanceStore } from "../theme/useAppearanceStore";
import { SettingsDialog, SettingsHost } from "./SettingsDialog";
import { openSettings } from "./settingsEvents";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Settings is the home appearance never had (ADR-0071).
 *
 * What is asserted is the boundary, not the paint: the theme switcher is one
 * door in, the palette is another, every control reaches the preference store,
 * and a change repaints the root with an attribute. Whether compact is 4px or
 * 6px of padding is the stylesheet's business.
 */
const dialog = () => screen.queryByTestId("settings-dialog");

beforeEach(() => {
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE });
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-canvas");
  document.documentElement.removeAttribute("data-motion");
});

afterEach(cleanup);

describe("settings", () => {
  it("opens from the theme switcher, and the menu closes behind it", () => {
    render(<ThemeToggle />);

    expect(dialog()).toBeNull();
    fireEvent.click(screen.getByTestId("theme-toggle"));
    fireEvent.click(screen.getByTestId("theme-appearance"));

    expect(dialog()).not.toBeNull();
    expect(screen.queryByTestId("theme-menu")).toBeNull();
    expect(screen.getByTestId("appearance-dialog")).toBeTruthy();
  });

  it("opens from the palette's request, not only from the menu", async () => {
    render(<SettingsHost />);

    openSettings();

    await waitFor(() => expect(dialog()).not.toBeNull());
  });

  it("traps Tab, because it says aria-modal", () => {
    render(<SettingsDialog onClose={() => {}} />);
    const panel = screen.getByTestId("settings-dialog");
    const controls = panel.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled])",
    );
    const tail = controls[controls.length - 1];
    expect(tail).toBeDefined();
    expect(panel.contains(document.activeElement)).toBe(true);

    tail?.focus();
    fireEvent.keyDown(tail as HTMLElement, { key: "Tab" });

    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(tail);
  });

  it("closes on Escape and on the close control", () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);

    fireEvent.keyDown(screen.getByTestId("settings-dialog"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("appearance-close"));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("offers the four things a reader owns alone", () => {
    render(<SettingsDialog onClose={() => {}} />);

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
    render(<SettingsDialog onClose={() => {}} />);

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
    render(<SettingsDialog onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("appearance-reset"));

    expect(useAppearanceStore.getState().appearance).toEqual(DEFAULT_APPEARANCE);
    expect(document.documentElement.dataset.density).toBe(DEFAULT_APPEARANCE.density);
  });

  it("says whose preference this is", () => {
    render(<SettingsDialog onClose={() => {}} />);

    expect(screen.getByTestId("appearance-dialog")).toHaveTextContent(
      "These change this device only",
    );
  });
});

describe("the workspace palette mirror", () => {
  it("names the scope and the roles rather than offering a second editor", () => {
    const workspace = useCanvasStore.getState().workspace;
    workspace.setWorkspaceTheme(null);
    render(<SettingsDialog onClose={() => {}} />);

    expect(screen.getByTestId("appearance-workspace-theme")).toHaveTextContent("Built-in palette");
    expect(screen.queryByTestId("workspace-theme-light-surface")).toBeNull();

    workspace.setWorkspaceTheme({ light: { surface: "#fdf6e3", ink: "#201c14" }, dark: {} });
    cleanup();
    render(<SettingsDialog onClose={() => {}} />);
    expect(screen.getByTestId("appearance-workspace-theme")).toHaveTextContent(
      "2 role(s) set here, light mode",
    );
    workspace.setWorkspaceTheme(null);
  });
});
