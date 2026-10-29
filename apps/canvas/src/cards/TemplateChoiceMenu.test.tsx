import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TemplateChoiceMenu } from "./TemplateChoiceMenu";

/**
 * The chooser exists because a type with more than one template cannot answer "what does a new
 * card look like" by itself. It is only ever opened when that is true, so what matters here is
 * that every template is offered by name, that a blank card is always possible, and that
 * picking closes the menu by answering.
 */
const choice = {
  typeId: "recipe",
  typeName: "Recipe",
  templates: [
    { id: "card-1", title: "Sourdough" },
    { id: "card-2", title: "Focaccia" },
  ],
};

describe("the template chooser", () => {
  it("names the type and offers every template", () => {
    render(<TemplateChoiceMenu choice={choice} onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("menu")).toHaveAccessibleName("New Recipe from a template");
    expect(screen.getByTestId("template-choice-card-1")).toHaveTextContent("Sourdough");
    expect(screen.getByTestId("template-choice-card-2")).toHaveTextContent("Focaccia");
  });

  it("answers with the template that was picked", () => {
    const onPick = vi.fn();
    render(<TemplateChoiceMenu choice={choice} onPick={onPick} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("template-choice-card-2"));
    expect(onPick).toHaveBeenCalledWith("card-2");
  });

  it("always allows a blank card", () => {
    const onPick = vi.fn();
    render(<TemplateChoiceMenu choice={choice} onPick={onPick} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("template-choice-blank"));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("closes without a card when the reader backs out", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<TemplateChoiceMenu choice={choice} onPick={onPick} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close template choice"));
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});
