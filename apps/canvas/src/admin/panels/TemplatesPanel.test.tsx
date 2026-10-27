import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AdminTemplate,
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from "../api";
import { TemplatesPanel } from "./TemplatesPanel";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    listTemplates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
  };
});

const BLANK: AdminTemplate = {
  id: "blank",
  name: "Blank starter",
  description: "Two boards, four cards",
  version: 3,
  data: {
    boards: [
      {
        name: "First",
        sections: [{ title: "Notes", cards: [{ title: "a" }, { title: "b" }] }],
        cards: [{ title: "c" }],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
      },
      {
        name: "Second",
        sections: [
          { title: "Empty", cards: [] },
          { title: "More", cards: [{ title: "d" }] },
        ],
        edges: [{ from: "d", to: "d" }],
      },
    ],
  },
};

// The control plane validates none of `data`, so a row can hold anything at all.
const BROKEN: AdminTemplate = {
  id: "broken",
  name: "Broken starter",
  description: "",
  version: 1,
  data: "not a template",
};

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!(row instanceof HTMLElement)) throw new Error(`no row holding ${text}`);
  return row;
}

function cellsOf(text: string): HTMLElement[] {
  return within(rowOf(text)).getAllByRole("cell");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTemplates).mockResolvedValue({ ok: true, templates: [BLANK, BROKEN] });
});

describe("templates panel", () => {
  it("lists every template with the counts its data holds", async () => {
    render(<TemplatesPanel token="secret" />);

    await screen.findByText("Blank starter");
    const cells = cellsOf("Blank starter");
    expect(cells[0]).toHaveTextContent("blank");
    expect(cells[1]).toHaveTextContent("3");
    expect(cells[2]).toHaveTextContent("Two boards, four cards");
    expect(cells[3]).toHaveTextContent("2");
    expect(cells[4]).toHaveTextContent("3");
    expect(cells[5]).toHaveTextContent("4");
  });

  it("renders a template whose data is not a template at all", async () => {
    render(<TemplatesPanel token="secret" />);

    await screen.findByText("Broken starter");
    expect(within(rowOf("Broken starter")).getAllByText("—")).toHaveLength(3);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("renames inline and sends the stored data back with the new name", async () => {
    vi.mocked(updateTemplate).mockResolvedValue({ ok: true, template: BLANK });
    render(<TemplatesPanel token="secret" />);

    await screen.findByText("Blank starter");
    fireEvent.click(within(rowOf("Blank starter")).getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Rename Blank starter");
    fireEvent.change(input, { target: { value: "  Weekly review  " } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(updateTemplate).toHaveBeenCalledWith("secret", "blank", {
        name: "Weekly review",
        description: "Two boards, four cards",
        data: BLANK.data,
      }),
    );
  });

  it("edits the description and keeps the rest of the template intact", async () => {
    vi.mocked(updateTemplate).mockResolvedValue({ ok: true, template: BLANK });
    render(<TemplatesPanel token="secret" />);

    await screen.findByText("Two boards, four cards");
    fireEvent.click(within(rowOf("Blank starter")).getByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Description for Blank starter");
    fireEvent.change(input, { target: { value: "A weekly review board" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(updateTemplate).toHaveBeenCalledWith("secret", "blank", {
        name: "Blank starter",
        description: "A weekly review board",
        data: BLANK.data,
      }),
    );
  });

  it("deletes only after the inline confirmation, then reloads the list", async () => {
    vi.mocked(deleteTemplate).mockResolvedValue({ ok: true, deleted: true });
    render(<TemplatesPanel token="secret" />);

    await screen.findByText("Blank starter");
    expect(deleteTemplate).not.toHaveBeenCalled();
    fireEvent.click(within(rowOf("Blank starter")).getByRole("button", { name: "Delete" }));
    expect(deleteTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith("secret", "blank"));
    await waitFor(() => expect(listTemplates).toHaveBeenCalledTimes(2));
  });

  it("downloads the same object the new-template form reads", async () => {
    const captured: { blob?: Blob } = {};
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        captured.blob = blob;
        return "blob:template";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<TemplatesPanel token="secret" />);

    await screen.findByText("Blank starter");
    fireEvent.click(within(rowOf("Blank starter")).getByRole("button", { name: "Download" }));

    expect(click).toHaveBeenCalledTimes(1);
    if (captured.blob === undefined) throw new Error("no blob was created");
    const body = JSON.parse(await captured.blob.text()) as { id: string; version: number };
    expect(body.id).toBe("blank");
    expect(body.version).toBe(3);
    click.mockRestore();
  });

  it("imports a pasted template object exactly as a download writes it", async () => {
    vi.mocked(createTemplate).mockResolvedValue({ ok: true, template: BLANK });
    render(<TemplatesPanel token="secret" />);

    await screen.findByText("Blank starter");
    fireEvent.click(screen.getByRole("button", { name: "New template…" }));
    fireEvent.change(screen.getByLabelText("Template JSON"), {
      target: {
        value: JSON.stringify({
          id: "imported",
          name: "Imported",
          description: "",
          version: 2,
          data: { boards: [] },
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    await waitFor(() =>
      expect(createTemplate).toHaveBeenCalledWith("secret", {
        id: "imported",
        name: "Imported",
        description: "",
        version: 2,
        data: { boards: [] },
      }),
    );
  });

  it("asks for the token instead of drawing an empty table", () => {
    render(<TemplatesPanel token={null} />);

    expect(screen.getByText(/admin token is required/i)).toBeInTheDocument();
    expect(listTemplates).not.toHaveBeenCalled();
  });
});
