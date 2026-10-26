/**
 * The projection worker's public surface: the worker itself, the room helpers
 * the sync server and admin API call, and the shapes they exchange.
 */
export type { DraftHost } from "./apply.js";

export type {
  ProjectionRoomStats,
  ProjectionWorkerOptions,
  SharePublishResult,
  ShareStatus,
  ShareVersion,
} from "./model.js";
export {
  DEFAULT_HOSTED_ROOM_IDLE_HOURS,
  DEFAULT_PROJECTION_ROOM_LIMIT,
  forgetRoomDocument,
  loadLoroDocument,
  loroDocumentKey,
  loroDocumentKeys,
  type ProjectionRoomInfo,
  projectionRoomLimit,
  type RoomSweepReport,
  roomIdleHours,
  roomSessionCount,
  type SweptRoom,
} from "./rooms.js";
export { ProjectionWorker } from "./worker.js";
