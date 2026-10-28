import { useState } from "react";
import { disconnectRoom, errorText, listRooms } from "../api";
import { Button, ConfirmButton, ErrorLine, Muted, PanelHeader, shortId, useLoad } from "../ui";

/** A share room id embeds the link token; show enough to correlate, never the token. */
function roomLabel(roomId: string): string {
  return roomId.startsWith("share-") ? `share-…${roomId.slice(-4)}` : roomId;
}

export function RoomsPanel() {
  const rooms = useLoad(() => listRooms());
  const [actionError, setActionError] = useState<string | null>(null);

  const disconnect = async (roomId: string) => {
    setActionError(null);
    try {
      await disconnectRoom(roomId);
      rooms.reload();
    } catch (cause) {
      setActionError(errorText(cause));
      throw cause;
    }
  };

  const data = rooms.data;

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Rooms"
        description="Socket rooms the sync server reports, and the projection rooms the worker holds."
        actions={
          <Button onClick={rooms.reload} disabled={rooms.loading}>
            {rooms.loading ? "Loading…" : "Refresh"}
          </Button>
        }
      />
      <ErrorLine message={actionError ?? rooms.error} />
      {data === null ? (
        rooms.loading ? (
          <Muted>Loading…</Muted>
        ) : null
      ) : (
        <>
          <h3>Socket rooms</h3>
          {data.rooms.length === 0 ? (
            <Muted>No live socket rooms, or this server cannot enumerate them.</Muted>
          ) : (
            <div className="admin-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Clients</th>
                    <th>Owner</th>
                    <th>Share</th>
                    <th>Internal</th>
                    <th>Anonymous</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rooms.map((room) => (
                    <tr key={room.roomId}>
                      <td className="admin-mono" title={room.roomId}>
                        {roomLabel(room.roomId)}
                      </td>
                      <td>{room.clients}</td>
                      <td>{room.authKinds?.owner ?? "—"}</td>
                      <td>{room.authKinds?.share ?? "—"}</td>
                      <td>{room.authKinds?.internal ?? "—"}</td>
                      <td>{room.authKinds?.anonymous ?? "—"}</td>
                      <td className="admin-actions">
                        <ConfirmButton
                          label="Disconnect"
                          confirmLabel="Confirm disconnect"
                          onConfirm={() => disconnect(room.roomId)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3>Projection rooms</h3>
          <p className="admin-muted">{data.note}</p>
          {data.projectionRooms.length === 0 ? (
            <Muted>No projection rooms are open.</Muted>
          ) : (
            <div className="admin-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Share</th>
                    <th>Workspace</th>
                    <th>Role</th>
                    <th>Baseline</th>
                    <th>Draft</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.projectionRooms.map((room) => (
                    <tr key={room.shareId}>
                      <td className="admin-mono" title={room.shareId}>
                        {shortId(room.shareId, 22)}
                      </td>
                      <td className="admin-mono" title={room.workspaceId}>
                        {shortId(room.workspaceId, 26)}
                      </td>
                      <td>{room.role}</td>
                      <td>{room.hasBaseline ? "yes" : "no"}</td>
                      <td>{room.dirty ? "dirty" : "clean"}</td>
                      <td className="admin-actions">
                        <ConfirmButton
                          label="Disconnect"
                          confirmLabel="Confirm disconnect"
                          onConfirm={() => disconnect(room.roomId)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
