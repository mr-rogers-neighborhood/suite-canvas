import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../theme/useThemeStore";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: "system" });
  });

  it("should open one menu from a single control", () => {
    render(<ThemeToggle />);
    expect(screen.queryByTestId("theme-menu")).toBeNull();
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(screen.getByTestId("theme-menu")).toBeInTheDocument();
    expect(screen.getByTestId("theme-system")).toHaveAttribute("data-checked", "true");
    expect(screen.getByTestId("theme-light")).toHaveAttribute("data-checked", "false");
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

    expect(screen.getByTestId("theme-light")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("theme-light"), { key: "End" });
    expect(screen.getByTestId("theme-appearance")).toHaveFocus();
  });
});
