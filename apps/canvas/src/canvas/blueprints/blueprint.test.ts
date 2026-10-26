import { WorkspaceDocument } from "@suite/graph";
import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import {
  allCapabilities,
  type CommandActions,
  type CommandContext,
  commandsFor,
  paletteInvocations,
} from "../../command/commandRegistry";
import {
  applyBlueprintInstall,
  type BlueprintSpec,
  installBlueprintCard,
  planBlueprintInstall,
  readBlueprint,
} from "./blueprint";

/** The body shape a card body has once the editor's container is turned into JSON. */
function node(nodeName: string, ...children: unknown[]) {
  return { nodeName, children };
}

function text(value: string) {
  return { nodeName: "text", text: value };
}

function paragraph(value: string) {
  return node("paragraph", text(value));
}

function heading(value: string) {
  return node("heading", text(value));
}

function bullet(...lines: string[]) {
  return node("bulletList", ...lines.map((line) => node("listItem", paragraph(line))));
}

function doc(...children: unknown[]) {
  return { nodeName: "doc", children };
}

const catalogueCard = doc(
  paragraph("What the source claims, in the reader's own words."),
  paragraph("Version: 3"),
  heading("Fields"),
  bullet("Confidence: select", "Source: card", "Reviewed: date *"),
);

const spec: BlueprintSpec = {
  name: "Claim",
  version: 1,
  fields: [
    { name: "Confidence", kind: "select", required: false },
    { name: "Source", kind: "card", required: false },
  ],
  starterContent: "Say what the source claims.",
};

describe("readBlueprint", () => {
  it("should read the name, the fields and the starter content", () => {
    const read = readBlueprint({ title: "  Claim ", body: catalogueCard });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.spec.name).toBe("Claim");
    expect(read.spec.version).toBe(3);
    expect(read.spec.fields).toEqual([
      { name: "Confidence", kind: "select", required: false },
      { name: "Source", kind: "card", required: false },
      { name: "Reviewed", kind: "date", required: true },
    ]);
    expect(read.spec.starterContent).toBe("What the source claims, in the reader's own words.");
  });

  it("should read a hyphen or an em dash as the separator", () => {
    const read = readBlueprint({
      title: "Claim",
      body: doc(heading("Fields"), bullet("Confidence - rating", "Source \u2014 card")),
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.spec.fields.map((field) => field.kind)).toEqual(["rating", "card"]);
  });

  it("should refuse a field kind nothing renders, naming the kind", () => {
    const read = readBlueprint({
      title: "Claim",
      body: doc(heading("Fields"), bullet("Confidence: vibes")),
    });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.code).toBe("blueprint.install.unsupported");
    expect(read.params.kind).toBe("vibes");
  });

  it("should refuse a card with nothing to install", () => {
    expect(readBlueprint({ title: "Claim", body: doc() }).ok).toBe(false);
    expect(readBlueprint({ title: "   ", body: catalogueCard }).ok).toBe(false);
    expect(readBlueprint({ title: "Claim", body: null }).ok).toBe(false);
  });

  it("should keep a content-only blueprint installable", () => {
    const read = readBlueprint({ title: "Journal", body: doc(paragraph("Three lines, morning.")) });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.spec.fields).toEqual([]);
    expect(read.spec.starterContent).toBe("Three lines, morning.");
  });
});

describe("planBlueprintInstall", () => {
  it("should mint a new id for every field on a first install", () => {
    let next = 0;
    const plan = planBlueprintInstall({
      spec,
      existingType: null,
      mintId: () => {
        next += 1;
        return `field-${next}`;
      },
    });
    expect(plan.kind).toBe("install");
    expect(plan.createType).toBe(true);
    expect(plan.addFields.map((entry) => entry.id)).toEqual(["field-1", "field-2"]);
    expect(plan.starterContent).toBe("Say what the source claims.");
  });

  it("should reuse the fields a type already has and add only the new one", () => {
    const plan = planBlueprintInstall({
      spec: {
        ...spec,
        version: 2,
        fields: [...spec.fields, { name: "Reviewed", kind: "date", required: false }],
      },
      existingType: {
        id: "claim",
        name: "Claim",
        fields: [{ name: "Confidence" }, { name: "Source" }],
      } as never,
      mintId: () => "fresh",
    });
    expect(plan.kind).toBe("install");
    expect(plan.createType).toBe(false);
    expect(plan.reusedFields).toEqual(["Confidence", "Source"]);
    expect(plan.addFields).toEqual([
      { id: "fresh", spec: { name: "Reviewed", kind: "date", required: false } },
    ]);
  });

  it("should match an existing field whatever its case", () => {
    const plan = planBlueprintInstall({
      spec,
      existingType: {
        id: "claim",
        name: "Claim",
        fields: [{ name: " confidence " }, { name: "Source" }],
      } as never,
      mintId: () => "fresh",
    });
    // Every declared field is already there, so there is nothing to write.
    expect(plan.kind).toBe("up-to-date");
    expect(plan.addFields).toEqual([]);
    expect(plan.reusedFields).toEqual(["Confidence", "Source"]);
  });

  it("should be up to date when the type covers the blueprint and the content is unchanged", () => {
    const plan = planBlueprintInstall({
      spec,
      existingType: {
        id: "claim",
        name: "Claim",
        fields: [{ name: "Confidence" }, { name: "Source" }],
      } as never,
    });
    expect(plan.kind).toBe("up-to-date");
    expect(plan.addFields).toEqual([]);
  });

  it("should install one field when only one was asked for", () => {
    const plan = planBlueprintInstall({
      spec,
      existingType: null,
      parts: { fields: ["Confidence"], starterContent: false },
      mintId: () => "only",
    });
    expect(plan.kind).toBe("install");
    expect(plan.addFields.map((entry) => entry.spec.name)).toEqual(["Confidence"]);
    expect(plan.skippedFields).toEqual(["Source"]);
    expect(plan.starterContent).toBeNull();
    expect(plan.createType).toBe(true);
  });

  it("should hand back only the starter content when that is the only unit asked for", () => {
    const plan = planBlueprintInstall({
      spec,
      existingType: null,
      parts: { type: false, fields: [], starterContent: true },
    });
    // Content is for a new card, not a write into the type, so there is nothing to install.
    expect(plan.kind).toBe("up-to-date");
    expect(plan.createType).toBe(false);
    expect(plan.addFields).toEqual([]);
    expect(plan.starterContent).toBe("Say what the source claims.");
  });

  it("should refuse to install nothing at all", () => {
    const plan = planBlueprintInstall({
      spec,
      existingType: null,
      parts: { type: false, fields: [], starterContent: false },
    });
    expect(plan.kind).toBe("empty");
  });
});

describe("applyBlueprintInstall", () => {
  it("should create the type and its fields through the document", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const read = readBlueprint({ title: "Claim", body: catalogueCard });
    if (!read.ok) throw new Error("expected a blueprint");

    const plan = planBlueprintInstall({ spec: read.spec, existingType: null });
    const result = applyBlueprintInstall(workspace, plan);
    if (!result) throw new Error("expected an install");

    const type = workspace.getType(result.typeId);
    expect(result.createdType).toBe(true);
    expect(type?.name).toBe("Claim");
    expect(type?.fields.map((field) => field.name)).toEqual(["Confidence", "Source", "Reviewed"]);
    expect(type?.fields.map((field) => field.kind)).toEqual(["select", "card", "date"]);
    expect(type?.fields.find((field) => field.name === "Reviewed")?.required).toBe(true);
    expect(result.addedFieldIds).toEqual(type?.fields.map((field) => field.id));
  });

  it("should give a second install nothing to add and no duplicate field", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const read = readBlueprint({ title: "Claim", body: catalogueCard });
    if (!read.ok) throw new Error("expected a blueprint");

    applyBlueprintInstall(workspace, planBlueprintInstall({ spec: read.spec, existingType: null }));
    const again = planBlueprintInstall({
      spec: read.spec,
      existingType: workspace.listTypes().find((type) => type.name === "Claim") ?? null,
    });
    expect(again.kind).toBe("up-to-date");

    const result = applyBlueprintInstall(workspace, again);
    expect(result?.createdType).toBe(false);
    expect(result?.addedFieldIds).toEqual([]);
    const types = workspace.listTypes().filter((type) => type.name === "Claim");
    expect(types).toHaveLength(1);
    expect(types[0]?.fields).toHaveLength(3);
  });

  it("should add only the field a newer blueprint brings", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const type = workspace.createType({ name: "Claim" });
    const confidence = workspace.addField(type.id, { name: "Confidence", kind: "select" });

    const plan = planBlueprintInstall({
      spec: {
        ...spec,
        version: 2,
        fields: [...spec.fields, { name: "Reviewed", kind: "date", required: false }],
      },
      existingType: workspace.listTypes().find((entry) => entry.name === "Claim") ?? null,
    });
    const result = applyBlueprintInstall(workspace, plan);
    const fields = workspace.getType(result?.typeId ?? "")?.fields ?? [];
    expect(fields.map((field) => field.name)).toEqual(["Confidence", "Source", "Reviewed"]);
    // The id the workspace already had keeps its identity, so stored values survive.
    expect(fields.find((field) => field.name === "Confidence")?.id).toBe(confidence.id);
  });
});

/** Writes one paragraph into a Loro body container, the way the editor does. */
function writeParagraph(container: LoroMap, value: string, nodeName = "paragraph") {
  const children = container.ensureMergeableList("children");
  const node = children.insertContainer(children.length, new LoroMap());
  node.set("nodeName", nodeName);
  node.ensureMergeableMap("attributes");
  const textChildren = node.ensureMergeableList("children");
  textChildren.insertContainer(0, new LoroText()).insert(0, value);
}

describe("installBlueprintCard", () => {
  /** A catalog card: its title is the type name, its body declares the fields. */
  function catalogCard(workspace: WorkspaceDocument): string {
    const board = workspace.ensureBoard();
    const card = workspace.createCard({ boardId: board.id, typeId: "note" });
    const title = workspace.getTitle(card.id);
    writeParagraph(title, "Claim");
    const body = workspace.getContent(card.id);
    writeParagraph(body, "Say what the source claims.");
    writeParagraph(body, "Fields", "heading");
    const list = body.ensureMergeableList("children");
    const listNode = list.insertContainer(list.length, new LoroMap());
    listNode.set("nodeName", "bulletList");
    for (const line of ["Confidence: select", "Source: card"]) {
      const items = listNode.ensureMergeableList("children");
      const item = items.insertContainer(items.length, new LoroMap());
      item.set("nodeName", "listItem");
      writeParagraph(item, line);
    }
    workspace.doc.commit({ origin: "test" });
    return card.id;
  }

  it("should read the card and install its type in one step", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const cardId = catalogCard(workspace);

    workspace.stopCapturing();
    const install = installBlueprintCard(workspace, cardId);

    expect(install.blueprint.ok).toBe(true);
    expect(install.plan?.kind).toBe("install");
    expect(install.result?.createdType).toBe(true);
    const type = workspace.getType(install.result?.typeId ?? "");
    expect(type?.name).toBe("Claim");
    expect(type?.fields.map((field) => field.name)).toEqual(["Confidence", "Source"]);
  });

  it("should undo as one step", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const cardId = catalogCard(workspace);
    workspace.stopCapturing();

    installBlueprintCard(workspace, cardId);
    expect(workspace.listTypes().some((type) => type.name === "Claim")).toBe(true);

    workspace.undo();
    expect(workspace.listTypes().some((type) => type.name === "Claim")).toBe(false);
  });

  it("should install a chosen field only, and say what it skipped", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const cardId = catalogCard(workspace);
    workspace.stopCapturing();

    const install = installBlueprintCard(workspace, cardId, { fields: ["Source"] });
    const type = workspace.getType(install.result?.typeId ?? "");
    expect(type?.fields.map((field) => field.name)).toEqual(["Source"]);
    expect(install.plan?.skippedFields).toEqual(["Confidence"]);
  });

  it("should write nothing for a card that is not a blueprint", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    const card = workspace.createCard({ boardId: board.id, typeId: "note" });

    const install = installBlueprintCard(workspace, card.id);
    expect(install.blueprint.ok).toBe(false);
    expect(install.plan).toBeNull();
    expect(install.result).toBeNull();
    expect(workspace.listTypes().every((type) => type.name !== "Untitled")).toBe(true);
  });

  it("should report an install that had nothing left to add", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const cardId = catalogCard(workspace);

    installBlueprintCard(workspace, cardId);
    const again = installBlueprintCard(workspace, cardId);
    expect(again.plan?.kind).toBe("up-to-date");
    expect(again.result).toBeNull();
    expect(workspace.listTypes().filter((type) => type.name === "Claim")).toHaveLength(1);
  });
});

describe("the command that runs it", () => {
  const context = (
    installBlueprint?: () => void,
    cardId: string | null = "catalog",
  ): CommandContext => ({
    capabilities: allCapabilities,
    state: {
      workspaceSurface: true,
      readOnly: false,
      paletteOpen: false,
      libraryOpen: false,
      libraryTab: "cards",
      activeBoardId: "board-1",
      activeViewId: null,
      cardId,
      cardPlaced: true,
      boards: [{ id: "board-1", name: "Catalog" }],
      views: [],
      sections: [],
      cards: [{ id: "catalog", title: "Claim", typeName: "note" }],
      types: [{ id: "note", name: "note" }],
      trashedCount: 0,
    },
    actions: { ...({} as CommandActions), installBlueprint } as CommandActions,
  });

  it("should be listed only where the board supplied a handler", () => {
    expect(commandsFor("canvas", context(vi.fn())).map((entry) => entry.id)).toContain(
      "type.installBlueprint",
    );
    expect(commandsFor("canvas", context(undefined)).map((entry) => entry.id)).not.toContain(
      "type.installBlueprint",
    );
  });

  it("should need a selected card, which is the blueprint", () => {
    expect(paletteInvocations(context(vi.fn(), null)).map((row) => row.commandId)).not.toContain(
      "type.installBlueprint",
    );
  });

  it("should run the handler the board owns", () => {
    const installBlueprint = vi.fn();
    const [row] = paletteInvocations(context(installBlueprint)).filter(
      (entry) => entry.commandId === "type.installBlueprint",
    );
    if (!row) throw new Error("expected a palette row");
    row.run();
    expect(installBlueprint).toHaveBeenCalledTimes(1);
  });
});
