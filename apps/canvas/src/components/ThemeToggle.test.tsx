import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../theme/useThemeStore";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: "system" });
  });

  it("should mark the active mode as checked", () => {
    render(<ThemeToggle />);
    expect(screen.getByTestId("theme-system")).toHaveAttribute("data-checked", "true");
    expect(screen.getByTestId("theme-light")).toHaveAttribute("data-checked", "false");
  });

  it("should switch mode when an option is chosen", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-dark"));
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(screen.getByTestId("theme-dark")).toHaveAttribute("data-checked", "true");
  });
});
