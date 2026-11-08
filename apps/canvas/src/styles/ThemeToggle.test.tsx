import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../theme/useThemeStore";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: "system", preset: "suite" });
  });

  it("should open one menu from a single control", () => {
    render(<ThemeToggle />);
    expect(screen.queryByTestId("theme-menu")).toBeNull();
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(screen.getByTestId("theme-menu")).toBeInTheDocument();
    expect(screen.getByTestId("theme-system")).toHaveAttribute("data-checked", "true");
    expect(screen.getByTestId("theme-light")).toHaveAttribute("data-checked", "false");
  });

  it("should offer the presets above the brightness options", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));

    // A palette family, then how bright to draw it: two questions, in the order they are
    // asked. The preset list comes first because it is the bigger of the two choices.
    const items = screen
      .getAllByRole("menuitemradio")
      .map((node) => node.getAttribute("data-testid"));
    expect(items.slice(0, 3)).toEqual([
      "theme-preset-suite",
      "theme-preset-solarized",
      "theme-preset-logseq",
    ]);
    expect(items.slice(3)).toEqual(["theme-light", "theme-dark", "theme-system"]);
  });

  it("should mark the preset in use and switch when another is chosen", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(screen.getByTestId("theme-preset-suite")).toHaveAttribute("data-checked", "true");

    fireEvent.click(screen.getByTestId("theme-preset-solarized"));

    expect(useThemeStore.getState().preset).toBe("solarized");
    expect(screen.queryByTestId("theme-menu")).toBeNull();
  });

  it("should switch mode and close the menu when an option is chosen", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    fireEvent.click(screen.getByTestId("theme-dark"));
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(screen.queryByTestId("theme-menu")).toBeNull();
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute("data-mode", "dark");
  });
});

describe("ThemeToggle keyboard", () => {
  it("moves focus into the menu and walks it with the arrows", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByTestId("theme-toggle"));

    // The first item is the first preset, which is where the menu now begins.
    expect(screen.getByTestId("theme-preset-suite")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("theme-preset-suite"), { key: "End" });
    expect(screen.getByTestId("theme-appearance")).toHaveFocus();
  });
});
