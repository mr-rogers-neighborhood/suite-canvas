import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  SaveTemplateInput,
  TemplateSaved,
  TemplateSaveOutcome,
} from "../templates/captureClient";
import { SaveTemplateDialog } from "./SaveTemplateDialog";

function saved(overrides: Partial<TemplateSaved> = {}): TemplateSaved {
  return {
    ok: true,
    id: "research",
    name: "Research",
    assets: 2,
    dropped: 0,
    bytes: 1024,
    ...overrides,
  };
}

function open(
  outcome: TemplateSaveOutcome | (() => Promise<TemplateSaveOutcome>),
  props: { title?: string; onSaved?: (notice: string) => void } = {},
) {
  const onClose = vi.fn();
  const save = vi.fn<(input: SaveTemplateInput) => Promise<TemplateSaveOutcome>>(() =>
    typeof outcome === "function" ? outcome() : Promise.resolve(outcome),
  );
  render(
    <SaveTemplateDialog
      workspace={new WorkspaceDocument()}
      title={props.title ?? "Research"}
      onClose={onClose}
      save={save}
      {...(props.onSaved ? { onSaved: props.onSaved } : {})}
    />,
  );
  return { save, onClose };
}

describe("the save-as-template prompt", () => {
  it("offers the workspace's title as the name and hands both fields to the capture", async () => {
    const { save } = open(saved());

    expect(screen.getByTestId("save-template-name")).toHaveValue("Research");
    fireEvent.change(screen.getByTestId("save-template-description"), {
      target: { value: "Questions and findings" },
    });
    fireEvent.click(screen.getByTestId("save-template-submit"));

    await screen.findByTestId("save-template-saved");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      name: "Research",
      description: "Questions and findings",
    });
  });

  it("says what it is doing, then that new workspaces can start from it, and stays put", async () => {
    // A holder rather than a `let`: the assignment happens inside the promise's
    // executor, which the narrowing of a plain local cannot see.
    const control: { announce?: () => void } = {};
    const { onClose } = open(
      () =>
        new Promise<TemplateSaveOutcome>((resolve) => {
          control.announce = () => resolve(saved());
        }),
    );

    fireEvent.click(screen.getByTestId("save-template-submit"));
    expect(await screen.findByTestId("save-template-progress")).toHaveTextContent(
      "Reading the boards and their pictures",
    );

    control.announce?.();
    const result = await screen.findByTestId("save-template-saved");
    expect(result).toHaveTextContent("New workspaces can start from it");
    expect(result).toHaveTextContent("2 pictures");

    // The operator is left where they were: nothing closed and nothing navigated.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("save-template-dialog")).toBeInTheDocument();
  });

  it("passes the saved result to the app bar when it is dismissed", async () => {
    const onSaved = vi.fn();
    const { onClose } = open(saved(), { onSaved });

    fireEvent.click(screen.getByTestId("save-template-submit"));
    await screen.findByTestId("save-template-saved");
    fireEvent.click(screen.getByTestId("save-template-submit"));

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0]?.[0]).toContain("Research");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal in place and leaves the way to try again", async () => {
    const { save } = open({
      ok: false,
      reason: "no-token",
      message: "Saving a starter template needs the operator token.",
    });

    fireEvent.click(screen.getByTestId("save-template-submit"));

    const error = await screen.findByTestId("save-template-error");
    expect(error).toHaveTextContent("needs the operator token");
    expect(screen.getByTestId("save-template-submit")).toBeEnabled();
    expect(screen.queryByTestId("save-template-saved")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("save-template-submit"));
    await screen.findByTestId("save-template-error");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("cannot fire twice while it is running", async () => {
    const control: { announce?: () => void } = {};
    const { save } = open(
      () =>
        new Promise<TemplateSaveOutcome>((resolve) => {
          control.announce = () => resolve(saved());
        }),
    );

    const submit = screen.getByTestId("save-template-submit");
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);
    await screen.findByTestId("save-template-progress");

    expect(save).toHaveBeenCalledTimes(1);
    control.announce?.();
    await screen.findByTestId("save-template-saved");
  });

  it("will not submit a nameless template", () => {
    const { save } = open(saved());

    fireEvent.change(screen.getByTestId("save-template-name"), { target: { value: "   " } });
    expect(screen.getByTestId("save-template-submit")).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
});
