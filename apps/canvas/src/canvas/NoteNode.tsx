import type { GraphNode } from "@suite/graph";
import { Handle, type NodeProps, type NodeTypes, Position } from "@xyflow/react";
import { useMemo } from "react";
import type { PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { NodeCard } from "../components/NodeCard";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

export function NoteNode({ id, data, selected }: NodeProps) {
  const node = data.node as GraphNode;
  const graph = useCanvasStore((state) => state.graph);
  const awareness = usePresenceStore((state) => state.awareness);
  const peers = usePresenceStore((state) => state.peers);
  const editing = useUiStore((state) => state.editingNodeId === id);
  const setEditingNodeId = useUiStore((state) => state.setEditingNodeId);

  const fragment = useMemo(() => graph.getContent(id), [graph, id]);

  const presence = useMemo<PresenceUser[]>(() => {
    return Object.values(peers)
      .filter((peer) => peer.focus?.nodeId === id)
      .map((peer) => peer.user);
  }, [peers, id]);

  return (
    <div>
      <Handle type="target" position={Position.Top} />
      <NodeCard
        node={node}
        fragment={fragment}
        awareness={awareness}
        selected={selected}
        editing={editing}
        presence={presence}
        onEditEnd={() => setEditingNodeId(null)}
      />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = { note: NoteNode } satisfies NodeTypes;
