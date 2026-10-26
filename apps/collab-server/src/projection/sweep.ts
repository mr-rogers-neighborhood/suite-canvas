import { message, type RoomState } from "./model.js";
import { HOUR_MS, type RoomSweepReport, roomIdleHours, sweptRoom } from "./rooms.js";

/**
 * The idle sweep. A projection room costs a live document, so a link nobody
 * has used for the idle window is revoked through the same path an operator
 * revoke takes: the store revokes the link, then the worker's next reconcile
 * pass leaves the room and drops its documents and baseline.
 *
 * It is a collaborator rather than worker methods because it is the one part of
 * the worker that runs on a timer, and its whole job is deciding *which* rooms
 * to hand back to the revoke path.
 */

export interface SweepHost {
  isStarted(): boolean;
  now(): number;
  /** Idle window in hours; `0` switches the sweep off. */
  idleHours(): number;
  rooms(): Iterable<RoomState>;
  /** Sessions in a room other than the worker's own, or `null` when unknown. */
  roomClients(roomId: string): number | null;
  /** Whether the share store can revoke a link at all. */
  canRevokeShares(): boolean;
  revokeShare(shareId: string): void;
  enqueue<T>(workspaceId: string, work: () => Promise<T>): Promise<T>;
  reconcileRooms(workspaceId: string): Promise<void>;
  hasRoom(roomId: string): boolean;
  forgetRoom(roomId: string): void;
  warn(text: string): void;
}

export class RoomSweeper {
  /** Tail of the chain, so two operator calls never interleave. */
  private sweeping: Promise<void> = Promise.resolve();

  constructor(private readonly host: SweepHost) {}

  /**
   * Revokes the links of projection rooms nobody has used for the idle window.
   *
   * A room qualifies when no owner save, publish, reload or status read has
   * touched it for `idleHours` **and** the sync server reports no session in it
   * other than the worker's own. A room whose sessions cannot be read is kept,
   * and a `dryRun` reports the candidates without touching them. With
   * `idleHours` at `0` — the self-host default — this is a no-op that still says
   * so in its report.
   */
  sweep(options: { dryRun?: boolean } = {}): Promise<RoomSweepReport> {
    // Serialized: two operator calls must not revoke, then race the cleanup.
    const next = this.sweeping.then(
      () => this.sweepNow(options.dryRun === true),
      () => this.sweepNow(options.dryRun === true),
    );
    this.sweeping = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async sweepNow(dryRun: boolean): Promise<RoomSweepReport> {
    const idleHours = this.host.idleHours();
    const report: RoomSweepReport = { idleHours, dryRun, checked: 0, unknown: 0, rooms: [] };
    if (!this.host.isStarted() || idleHours <= 0) return report;

    const now = this.host.now();
    const idleMs = idleHours * HOUR_MS;
    const candidates: RoomState[] = [];
    for (const room of this.host.rooms()) {
      report.checked += 1;
      if (now - room.lastActiveAt < idleMs) continue;
      const sessions = this.host.roomClients(room.roomId);
      if (sessions === null) {
        // No reader, or a server that cannot answer: never close blind.
        report.unknown += 1;
        continue;
      }
      if (sessions > 0) continue;
      candidates.push(room);
    }
    if (candidates.length === 0) return report;
    if (dryRun) {
      report.rooms = candidates.map((room) => sweptRoom(room, now));
      return report;
    }
    if (!this.host.canRevokeShares()) {
      this.host.warn("the room sweep needs a share store that can revoke links");
      return report;
    }

    // One rebuild per workspace closes every room it lost and deletes their
    // documents and baselines; that is the same cleanup a revoke always runs.
    const byWorkspace = new Map<string, RoomState[]>();
    for (const room of candidates) {
      const rooms = byWorkspace.get(room.workspaceId) ?? [];
      rooms.push(room);
      byWorkspace.set(room.workspaceId, rooms);
    }
    for (const [workspaceId, rooms] of byWorkspace) {
      for (const room of rooms) {
        try {
          this.host.revokeShare(room.shareId);
        } catch (error) {
          this.host.warn(`could not revoke the idle share ${room.shareId}: ${message(error)}`);
        }
      }
      await this.host.enqueue(workspaceId, () => this.host.reconcileRooms(workspaceId));
      for (const room of rooms) {
        if (this.host.hasRoom(room.roomId)) continue;
        report.rooms.push(sweptRoom(room, now));
        try {
          this.host.forgetRoom(room.roomId);
        } catch (error) {
          this.host.warn(`could not forget the room ${room.roomId}: ${message(error)}`);
        }
      }
    }
    if (report.rooms.length > 0) {
      this.host.warn(
        `swept ${report.rooms.length} idle projection room(s) older than ${idleHours} h`,
      );
    }
    return report;
  }
}

/** The idle window the worker applies, resolved from the environment once. */
export function idleHoursOf(options: { idleHours?: number }): number {
  return options.idleHours ?? roomIdleHours();
}
