import type { GraphNode } from "@suite/graph";
import { Handle, type NodeProps, type NodeTypes, Position } from "@xyflow/react";
import { NoteCard } from "../components/NoteCard";

export function NoteNode({ data, selected }: NodeProps) {
  const node = data.node as GraphNode;

  return (
    <div>
      <Handle type="target" position={Position.Top} />
      <NoteCard node={node} selected={selected} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = { note: NoteNode } satisfies NodeTypes;
