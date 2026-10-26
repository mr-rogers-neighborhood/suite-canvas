import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../../store/useCanvasStore";
import { WorkspaceThemeEditor } from "./WorkspaceThemeEditor";

const workspace = () => useCanvasStore.getState().workspace;

describe("WorkspaceThemeEditor", () => {
  beforeEach(() => {
    workspace().setWorkspaceTheme(null);
  });

  it("writes a role's colour per mode, not once for both", () => {
    render(<WorkspaceThemeEditor workspace={workspace()} canEdit />);

    fireEvent.change(screen.getByTestId("workspace-theme-light-surface"), {
      target: { value: "#fdf6e3" },
    });

    expect(workspace().workspaceTheme()).toEqual({ light: { surface: "#fdf6e3" }, dark: {} });
    // The dark column is still empty, which is what the row shows.
    expect(screen.getByTestId("workspace-theme-dark-surface")).toHaveValue("");
  });

  it("clears a role when its field is emptied, and the palette with the button", () => {
    workspace().setWorkspaceTheme({ light: { ink: "#101010" }, dark: { ink: "#f5f5f7" } });
    render(<WorkspaceThemeEditor workspace={workspace()} canEdit />);

    fireEvent.change(screen.getByTestId("workspace-theme-light-ink"), { target: { value: "" } });
    expect(workspace().workspaceTheme()).toEqual({ light: {}, dark: { ink: "#f5f5f7" } });

    fireEvent.click(screen.getByTestId("workspace-theme-clear"));
    expect(workspace().workspaceTheme()).toBeUndefined();
  });

  it("refuses writes without the schema capability", () => {
    render(<WorkspaceThemeEditor workspace={workspace()} canEdit={false} />);

    expect(screen.getByTestId("workspace-theme-light-surface")).toBeDisabled();
    expect(screen.queryByTestId("workspace-theme-clear")).toBeNull();
  });
});
