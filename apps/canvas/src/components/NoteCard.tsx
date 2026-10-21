import type { GraphNode } from "@suite/graph";

export interface NoteCardProps {
  node: GraphNode;
  selected?: boolean;
}

export function NoteCard({ node, selected = false }: NoteCardProps) {
  const title =
    node.kind === "document" ? node.data.title : node.kind === "tag" ? node.data.label : "Note";
  const body =
    node.kind === "note" ? node.data.text : node.kind === "document" ? node.data.body : null;

  return (
    <div
      className={`rounded-lg border bg-white p-3 shadow-sm ${
        selected ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200"
      }`}
      data-testid="note-card"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium uppercase text-gray-500">
          {node.kind}
        </span>
        <span className="truncate text-sm font-semibold text-gray-800">{title}</span>
      </div>
      {body ? <p className="text-xs text-gray-600">{body}</p> : null}
    </div>
  );
}
