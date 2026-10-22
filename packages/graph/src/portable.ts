import { getType, isContainer, type LoroList, type LoroMap, type LoroText } from "loro-crdt";
import type { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { formatPropertyValue } from "./property.js";
import type { Card, CardType, FieldDefinition, PropertyValue, Tag } from "./schema.js";

export const PORTABLE_EXPORT_KIND = "suite.portable";
export const PORTABLE_EXPORT_VERSION = 1;

export interface PortableNode {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: PortableNode[];
}

export interface PortableProperty {
  fieldId: string;
  name: string;
  kind: FieldDefinition["kind"];
  value: PropertyValue;
}

export interface PortableCard {
  id: string;
  title: string;
  typeId: string;
  typeName: string;
  tags: string[];
  properties: PortableProperty[];
  placements: Array<{
    boardId: string;
    x: number;
    y: number;
    z: number;
    width?: number;
    height?: number;
  }>;
  body: PortableNode[];
}

export interface PortableWorkspace {
  kind: typeof PORTABLE_EXPORT_KIND;
  version: typeof PORTABLE_EXPORT_VERSION;
  exportedAt: string;
  boards: Array<{ id: string; name: string }>;
  types: CardType[];
  tags: Tag[];
  cards: PortableCard[];
  references: Record<string, string[]>;
  markdown: string;
}

function isMap(value: unknown): value is LoroMap {
  return isContainer(value) && getType(value) === "Map";
}

function isList(value: unknown): value is LoroList {
  return isContainer(value) && getType(value) === "List";
}

function isText(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

function textNode(delta: { insert?: string; attributes?: Record<string, unknown> }): PortableNode {
  const attributes = delta.attributes ?? {};
  const marks = Object.entries(attributes).flatMap(([type, value]) => {
    if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) {
      return [{ type }];
    }
    if (typeof value === "object") {
      return [{ type, attrs: value as Record<string, unknown> }];
    }
    return [{ type }];
  });
  return {
    type: "text",
    text: delta.insert ?? "",
    ...(marks.length > 0 ? { marks } : {}),
  };
}

/** Converts a Loro ProseMirror container into plain ProseMirror JSON. */
export function loroTreeToJson(value: unknown): PortableNode[] {
  if (Array.isArray(value)) return value.flatMap(loroTreeToJson);
  if (isText(value)) {
    return value
      .toDelta()
      .flatMap((delta) =>
        typeof delta.insert === "string"
          ? [textNode(delta as { insert?: string; attributes?: Record<string, unknown> })]
          : [],
      );
  }
  if (isList(value)) return value.toArray().flatMap(loroTreeToJson);
  if (!isMap(value)) return [];

  const nodeName = value.get("nodeName");
  const children = value.get("children");
  // The body/title container is a document root: it has children but no name.
  if (typeof nodeName !== "string") {
    return isList(children) ? children.toArray().flatMap(loroTreeToJson) : [];
  }
  const attributes = value.get("attributes");
  const attrs = isMap(attributes) ? attributes.toJSON() : {};
  const content = isList(children) ? children.toArray().flatMap(loroTreeToJson) : [];
  return [
    {
      type: nodeName,
      ...(attrs && typeof attrs === "object" && Object.keys(attrs).length > 0
        ? { attrs: attrs as Record<string, unknown> }
        : {}),
      ...(content.length > 0 ? { content } : {}),
    },
  ];
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function formatValue(
  field: FieldDefinition,
  value: PropertyValue | undefined,
  context: MarkdownContext,
): string {
  return formatPropertyValue(field, value, {
    cardTitle: typeof value === "string" ? context.titles.get(value) : undefined,
    empty: "",
    unavailable: "Unavailable",
    formatCard: (title) => `[[${title}]]`,
  });
}

interface MarkdownContext {
  titles: Map<string, string>;
  fields: Map<string, FieldDefinition>;
  values: Record<string, PropertyValue>;
}

function inlineText(nodes: PortableNode[] | undefined, context: MarkdownContext): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "text") {
        let text = node.text ?? "";
        for (const mark of node.marks ?? []) {
          if (mark.type === "bold") text = `**${text}**`;
          else if (mark.type === "italic") text = `*${text}*`;
          else if (mark.type === "strike") text = `~~${text}~~`;
          else if (mark.type === "code") text = `\`${text}\``;
        }
        return text;
      }
      if (node.type === "mention") {
        const cardId = typeof node.attrs?.cardId === "string" ? node.attrs.cardId : "";
        return `[[${context.titles.get(cardId) ?? "Unavailable card"}]]`;
      }
      if (node.type === "hardBreak") return "  \n";
      return inlineText(node.content, context);
    })
    .join("");
}

function blockText(nodes: PortableNode[] | undefined, context: MarkdownContext): string {
  return (nodes ?? [])
    .map((node) => {
      switch (node.type) {
        case "paragraph":
          return inlineText(node.content, context);
        case "heading": {
          // Board is `#`, card is `##`; body headings start below them.
          const level = Number(node.attrs?.level ?? 1) + 2;
          return `${"#".repeat(Math.min(6, Math.max(3, level)))} ${inlineText(node.content, context)}`;
        }
        case "bulletList":
          return (node.content ?? [])
            .map((item) => `- ${blockText(item.content, context).replace(/\n/g, "\n  ")}`)
            .join("\n");
        case "orderedList":
          return (node.content ?? [])
            .map(
              (item, index) =>
                `${index + 1}. ${blockText(item.content, context).replace(/\n/g, "\n   ")}`,
            )
            .join("\n");
        case "listItem":
          return blockText(node.content, context);
        case "blockquote":
          return blockText(node.content, context)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        case "codeBlock": {
          const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
          return `\`\`\`${language}\n${(node.content ?? []).map((child) => child.text ?? "").join("")}\n\`\`\``;
        }
        case "horizontalRule":
          return "---";
        case "propertyBlock": {
          const fieldId = typeof node.attrs?.fieldId === "string" ? node.attrs.fieldId : "";
          const field = context.fields.get(fieldId);
          if (!field) return "_Missing field_";
          return `**${field.name}:** ${formatValue(field, context.values[fieldId], context)}`;
        }
        case "mention":
          return inlineText([node], context);
        default:
          return inlineText(node.content, context);
      }
    })
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function cardMarkdown(card: PortableCard, context: MarkdownContext): string {
  const lines: string[] = [`## ${card.title || "Untitled"}`];
  const meta = [card.typeName, ...card.tags].filter((value) => value.length > 0).join(" · ");
  if (meta) lines.push(`*${meta}*`);
  if (card.properties.length > 0) {
    lines.push("", "| Field | Value |", "| --- | --- |");
    for (const property of card.properties) {
      const field = context.fields.get(property.fieldId);
      const fallback: FieldDefinition = {
        id: property.fieldId,
        name: property.name,
        kind: property.kind,
        required: false,
        order: 0,
        options: [],
      };
      const value = formatValue(field ?? fallback, property.value, context);
      lines.push(`| ${escapeCell(field?.name ?? property.name)} | ${escapeCell(value)} |`);
    }
  }
  const body = blockText(card.body, context);
  if (body) lines.push("", body);
  return lines.join("\n");
}

function cardProperties(card: Card, typesById: Map<string, CardType>): PortableProperty[] {
  const type = typesById.get(card.primaryTypeId);
  if (!type) return [];
  return type.fields.flatMap((field) => {
    const value = card.properties[field.id];
    return value === undefined
      ? []
      : [{ fieldId: field.id, name: field.name, kind: field.kind, value }];
  });
}

/**
 * A readable projection of the workspace: JSON for tools, Markdown for people.
 * It is export-only; the exact `.suite` backup is the only import path.
 */
export function exportPortable(
  workspace: WorkspaceDocument,
  exportedAt = new Date().toISOString(),
): PortableWorkspace {
  const boards = workspace.listBoards();
  const types = workspace.listTypes();
  const tags = workspace.listTags();
  const typesById = new Map(types.map((type) => [type.id, type]));
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const cards = workspace
    .listCards()
    .filter((card) => !card.deletedAt)
    .map((card): PortableCard => {
      const placements = workspace.listCardPlacements(card.id).map((placement) => ({
        boardId: placement.boardId,
        x: placement.x,
        y: placement.y,
        z: placement.z,
        ...(placement.width !== undefined ? { width: placement.width } : {}),
        ...(placement.height !== undefined ? { height: placement.height } : {}),
      }));
      return {
        id: card.id,
        title: workspace.displayTitle(card.id),
        typeId: card.primaryTypeId,
        typeName: typesById.get(card.primaryTypeId)?.name ?? "Note",
        tags: card.tags.flatMap((id) => (tagsById.get(id) ? [tagsById.get(id)?.name ?? ""] : [])),
        properties: cardProperties(card, typesById),
        placements,
        body: loroTreeToJson(workspace.peekContent(card.id)),
      };
    });

  const titles = new Map(cards.map((card) => [card.id, card.title]));
  const fields = new Map(
    types.flatMap((type) => type.fields.map((field) => [field.id, field] as const)),
  );
  const cardById = new Map(cards.map((card) => [card.id, card]));

  const markdown: string[] = [`# Suite workspace`, "", `Exported ${exportedAt}`, ""];
  for (const board of boards) {
    markdown.push(`# ${board.name || "Untitled board"}`, "");
    const placed = cards
      .filter((card) => card.placements.some((placement) => placement.boardId === board.id))
      .sort((left, right) => {
        const leftPlacement = left.placements.find((placement) => placement.boardId === board.id);
        const rightPlacement = right.placements.find((placement) => placement.boardId === board.id);
        return (leftPlacement?.z ?? 0) - (rightPlacement?.z ?? 0);
      });
    if (placed.length === 0) markdown.push("_No cards on this board._", "");
    for (const card of placed) {
      const source = cardById.get(card.id);
      if (!source) continue;
      markdown.push(
        cardMarkdown(card, {
          titles,
          fields,
          values: Object.fromEntries(
            source.properties.map((property) => [property.fieldId, property.value]),
          ),
        }),
        "",
      );
    }
  }

  const inbox = cards.filter((card) => card.placements.length === 0);
  if (inbox.length > 0) {
    markdown.push("# Inbox", "");
    for (const card of inbox) {
      const source = cardById.get(card.id);
      if (!source) continue;
      markdown.push(
        cardMarkdown(card, {
          titles,
          fields,
          values: Object.fromEntries(
            source.properties.map((property) => [property.fieldId, property.value]),
          ),
        }),
        "",
      );
    }
  }

  return {
    kind: PORTABLE_EXPORT_KIND,
    version: PORTABLE_EXPORT_VERSION,
    exportedAt,
    boards: boards.map((board) => ({ id: board.id, name: board.name })),
    types,
    tags,
    cards,
    references: workspace.listReferences(),
    markdown: markdown.join("\n"),
  };
}
