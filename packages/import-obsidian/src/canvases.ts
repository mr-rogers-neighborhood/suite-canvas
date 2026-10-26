import type { SectionColor, WorkspaceDocument } from "@suite/graph";
import { type CanvasEdge, type CanvasNode, parseCanvas } from "./canvas.js";
import { blocksToNodes, type LinkResolver } from "./convert.js";
import { baseName, stemOf } from "./files.js";
import type { VaultIndex } from "./lookup.js";
import { canvasColour } from "./mapping.js";
import { type BlockToken, parseInline, parseMarkdown } from "./markdown.js";
import type { ImportReport } from "./report.js";

/**
 * Owns what one `.canvas` file becomes: a board whose nodes are cards and
 * sections at the geometry the canvas stored, and whose edges are links.
 *
 * A `file` node resolves to the card that note already became, so the same note
 * on two canvases is one card in two places rather than two copies.
 */

export interface CanvasImportInput {
  workspace: WorkspaceDocument;
  path: string;
  text: string;
  resolve: LinkResolver;
  index: VaultIndex;
  defaultTypeId: string;
  report: ImportReport;
}

export interface CanvasImportResult {
  boardId: string;
  cardIds: string[];
  sectionIds: string[];
}

const GROUP_FALLBACK_TITLE = "Group";

function geometry(node: CanvasNode): { x: number; y: number; width: number; height: number } {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

/**
 * A text node's first line is its title and the rest is its body, which is how the
 * node reads on an Obsidian canvas. A leading `#` heading still wins, because a
 * note-shaped node means it.
 */
function splitTextNode(text: string): { title: string; blocks: BlockToken[] } {
  const parsed = parseMarkdown(text);
  if (parsed.title) return { title: parsed.title, blocks: parsed.blocks };
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const index = lines.findIndex((line) => line.trim().length > 0);
  if (index < 0) return { title: "", blocks: [] };
  const rest = lines.slice(index + 1).join("\n");
  const remainder = parseMarkdown(rest);
  return {
    title: (lines[index] ?? "").trim().slice(0, 120),
    blocks: remainder.title
      ? [{ kind: "heading", level: 1, inline: parseInline(remainder.title) }, ...remainder.blocks]
      : remainder.blocks,
  };
}

/** Writes one canvas's nodes and edges. Returns null when the file cannot be read. */
export function importCanvas(input: CanvasImportInput): CanvasImportResult | null {
  const { workspace, path, report } = input;
  const parsed = parseCanvas(input.text);
  if (!parsed.ok) {
    report.files.skipped += 1;
    report.skipped.push({ path, reason: parsed.reason });
    return null;
  }

  const board = workspace.createBoard({ name: stemOf(path) });
  report.records.boards += 1;
  report.boards.push({ id: board.id, name: board.name });
  report.files.canvases += 1;

  const endpoints = new Map<string, { kind: "card" | "section"; id: string }>();
  const cardIds: string[] = [];
  const sectionIds: string[] = [];

  const colourOf = (node: CanvasNode): ReturnType<typeof canvasColour> => {
    const mapped = canvasColour(node.color);
    if (node.color && !mapped) report.colours.unmapped.push(`${path}: ${node.color}`);
    return mapped;
  };

  for (const node of parsed.canvas.nodes) {
    if (node.type === "group") {
      const mapped = colourOf(node);
      const section = workspace.createSection({
        boardId: board.id,
        title: node.label?.trim() || GROUP_FALLBACK_TITLE,
        ...geometry(node),
        ...(mapped ? { color: mapped.section as SectionColor } : {}),
      });
      if (mapped) report.colours.sections += 1;
      endpoints.set(node.id, { kind: "section", id: section.id });
      sectionIds.push(section.id);
      continue;
    }

    if (node.type === "file") {
      const target = (node.file ?? "").replace(/^.*?:\/\//u, "").split("#")[0] ?? "";
      const cardId = input.index.cardIdOf(target);
      if (cardId) {
        workspace.placeCard(board.id, cardId, { x: node.x, y: node.y });
        workspace.updatePlacementGeometry(board.id, cardId, geometry(node));
        endpoints.set(node.id, { kind: "card", id: cardId });
        cardIds.push(cardId);
        continue;
      }
      const card = workspace.createCard({
        boardId: board.id,
        position: { x: node.x, y: node.y },
        typeId: input.defaultTypeId,
        fromTemplate: false,
      });
      workspace.setTitleText(card.id, baseName(target));
      workspace.setBodyText(card.id, target);
      workspace.updatePlacementGeometry(board.id, card.id, geometry(node));
      report.notes.push(
        `${path}: the file node "${target}" names a file this vault does not have as a note, so its card carries the path as text.`,
      );
      endpoints.set(node.id, { kind: "card", id: card.id });
      cardIds.push(card.id);
      continue;
    }

    const text = node.type === "link" ? "" : (node.text ?? "");
    const split = splitTextNode(text);
    const title = node.type === "link" ? (node.url ?? "").trim() || "Link" : split.title || "Note";
    const card = workspace.createCard({
      boardId: board.id,
      position: { x: node.x, y: node.y },
      typeId: input.defaultTypeId,
      fromTemplate: false,
    });
    workspace.setTitleText(card.id, title);
    if (node.type === "link") {
      if ((node.url ?? "").length > 0) workspace.setBodyText(card.id, node.url ?? "");
    } else if (split.blocks.length > 0) {
      workspace.setBodyNodes(card.id, blocksToNodes(split.blocks, input.resolve).nodes);
    }
    workspace.updatePlacementGeometry(board.id, card.id, geometry(node));
    const mapped = colourOf(node);
    if (mapped) {
      workspace.setCardStyle(card.id, { surface: mapped.surface });
      report.colours.cards += 1;
    }
    endpoints.set(node.id, { kind: "card", id: card.id });
    cardIds.push(card.id);
  }

  for (const edge of parsed.canvas.edges) {
    if (!writeEdge(workspace, board.id, edge, endpoints, report)) {
      report.notes.push(
        `${path}: the edge ${edge.id} joins a node this canvas does not define, so it was skipped.`,
      );
    }
  }

  if (parsed.canvas.edges.length > 0) {
    report.notes.push(
      `${path}: link sides are not stored, so every edge uses the default connector layout.`,
    );
  }
  if (parsed.canvas.edges.some((edge) => edge.color)) {
    report.notes.push(
      `${path}: an edge colour has no slot in a link's style, so it is not stored.`,
    );
  }
  return { boardId: board.id, cardIds, sectionIds };
}

function writeEdge(
  workspace: WorkspaceDocument,
  boardId: string,
  edge: CanvasEdge,
  endpoints: ReadonlyMap<string, { kind: "card" | "section"; id: string }>,
  report: ImportReport,
): boolean {
  const from = endpoints.get(edge.fromNode);
  const to = endpoints.get(edge.toNode);
  if (!from || !to) return false;
  const created = workspace.addEdge({
    boardId,
    source: from.id,
    target: to.id,
    sourceKind: from.kind,
    targetKind: to.kind,
    kind: "references",
  });
  if (!created) return false;
  if (edge.label && edge.label.trim().length > 0) {
    workspace.setEdgeLabel(created.id, edge.label.trim());
  }
  report.records.links += 1;
  return true;
}
