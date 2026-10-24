import type { Connector, EdgeKind, EdgePath, PropertyValue } from "@suite/graph";

/**
 * Scene identity types. A scene is a pure projection of the graph snapshot plus
 * a camera: every instance is derived, nothing here is document truth.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned rectangle in flow (board) or page coordinates. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Uniform scale plus translation; maps board coordinates into page coordinates. */
export interface Transform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** Page -> screen: `screen = page * zoom + offset`. Matches React Flow's viewport. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** Board ids from the root board down to one instance. Detects cycles. */
export type ScenePath = readonly string[];

export type LodBand = "full" | "compact" | "icon" | "hidden";

/** Per-type LOD overrides are keyed by the kind of instance being resolved. */
export type LodKind = "card" | "portal" | "section" | "edge";

export interface LodThresholds {
  /** Lower bound of each band in effective scale. */
  readonly full: number;
  readonly compact: number;
  readonly icon: number;
}

export interface LodConfig {
  readonly thresholds: LodThresholds;
  /** Upgrade dwell in milliseconds; downgrades are immediate. */
  readonly dwellMs: number;
  readonly overrides?: Readonly<Partial<Record<LodKind, Partial<LodThresholds>>>> | undefined;
}

/** The resolved band of one instance, plus the upgrade it is waiting on. */
export interface LodState {
  readonly band: LodBand;
  readonly pendingBand: LodBand | null;
  readonly pendingSinceMs: number | null;
}

export type PortalGateReason =
  | "expanded"
  | "focus"
  | "dwell"
  | "scale"
  | "screen-size"
  | "cycle"
  | "depth"
  | "no-target";

/** Ephemeral per-instance expansion state; never stored in the document. */
export interface PortalGateState {
  readonly expanded: boolean;
  readonly pendingSinceMs: number | null;
}

export interface PortalConfig {
  /** Effective scale at or above which a collapsed portal may expand. */
  readonly expansionScale: number;
  /** Effective scale below which an expanded portal collapses immediately. */
  readonly collapseScale: number;
  /** Minimum on-screen side in pixels for either direction. */
  readonly minScreenSize: number;
  /** Dwell above the expansion threshold before expanding. */
  readonly dwellMs: number;
  /** Fit padding factor for the target board inside the portal frame. */
  readonly padding: number;
  /** Hard recursion cap; the root board is depth 0. */
  readonly maxDepth: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface SceneConfig {
  readonly lod: LodConfig;
  readonly portal: PortalConfig;
  /** Box assumed for a placement that was never resized. */
  readonly cardSize: Size;
  /** Bounds assumed for a board with no cards or sections. */
  readonly emptyBoardSize: Size;
}

/** Fractal layout presets (see `layout.ts` for the algorithms). */
export type LayoutPattern =
  | "grid"
  | "columns"
  | "rows"
  | "radial"
  | "spiral"
  | "phyllotaxis"
  | "rings"
  | "treemap";

export type LayoutAlign = "start" | "center" | "end";

export type LayoutOrder = "reading" | "z" | "created" | "type";

/** How a board's cards group into clusters when an arrangement recurses. */
export type LayoutClusterBy = "type" | "tag" | "order";

export interface LayoutDepthRecipe {
  /** Portal frame / child board ratio. */
  readonly scale: number;
  readonly gap: number;
  readonly rotate: number;
  readonly pattern?: LayoutPattern | undefined;
}

export interface FractalRecipe {
  readonly pattern: LayoutPattern;
  readonly gap: number;
  readonly padding: number;
  readonly align: LayoutAlign;
  readonly order: LayoutOrder;
  /** Optional seeded jitter in flow units; 0 keeps the pattern exact. */
  readonly jitter?: number | undefined;
  readonly seed?: number | undefined;
  readonly depth: LayoutDepthRecipe;
  /**
   * How deep the arrangement itself recurses. `1` (the default) is the flat
   * plan: one pattern over the board's cards. `2` arranges clusters with the
   * same pattern and each cluster with it again, and so on.
   */
  readonly levels?: number | undefined;
  /** Clusters each level splits its items into. Defaults to 3. */
  readonly branching?: number | undefined;
  /** Per-level geometric step applied to sizes and gaps. Defaults to 1/√2. */
  readonly scaleStep?: number | undefined;
  /** How a board's cards group into clusters. Defaults to `"order"`. */
  readonly cluster?: LayoutClusterBy | undefined;
  /**
   * Also propose a container for each cluster. Pure proposal: the plan returns
   * the rect and the cards, and the caller creates the Board if it wants one.
   */
  readonly nest?: boolean | undefined;
}

/* ------------------------------------------------------------------ inputs */

export interface SceneBoardInput {
  readonly id: string;
  readonly name: string;
}

export interface SceneCardInput {
  readonly id: string;
  readonly primaryTypeId: string;
  readonly properties: Readonly<Record<string, PropertyValue>>;
  readonly connectors?: readonly Connector[] | undefined;
}

export interface ScenePlacementInput {
  readonly boardId: string;
  readonly cardId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface SceneSectionInput {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly color?: string | undefined;
}

export interface SceneEdgeInput {
  readonly id: string;
  readonly boardId: string;
  readonly source: string;
  readonly target: string;
  readonly kind: EdgeKind;
  readonly path: EdgePath;
  readonly sourceConnector?: string | undefined;
  readonly targetConnector?: string | undefined;
  readonly label?: string | undefined;
}

export interface BuildSceneInput {
  readonly boards: readonly SceneBoardInput[];
  readonly cards: readonly SceneCardInput[];
  readonly placements: readonly ScenePlacementInput[];
  readonly sections?: readonly SceneSectionInput[] | undefined;
  readonly edges?: readonly SceneEdgeInput[] | undefined;
  readonly rootBoardId: string;
  readonly camera: Camera;
  readonly focusPath?: ScenePath | undefined;
  /** Card id -> label; titles live in rich text, so callers pass plain text. */
  readonly titles?: Readonly<Record<string, string>> | undefined;
  /** Previous resolved bands keyed by instance key; drives hysteresis. */
  readonly lodStates?: Readonly<Record<string, LodState>> | undefined;
  /** Previous portal gates keyed by portal instance key; drives dwell. */
  readonly gateStates?: Readonly<Record<string, PortalGateState>> | undefined;
  readonly nowMs?: number | undefined;
  readonly config?: Partial<SceneConfig> | undefined;
}

/* --------------------------------------------------------------- instances */

export interface BoardInstance {
  readonly key: string;
  readonly boardId: string;
  readonly name: string;
  readonly path: ScenePath;
  readonly depth: number;
  /** Portal instance that produced this board; null for the root board. */
  readonly parentKey: string | null;
  /** Maps this board's coordinates into page coordinates. */
  readonly transform: Transform;
  /** Content bounds in board coordinates (cards, sections, portal frames). */
  readonly bounds: Rect;
  /** `bounds` mapped into page coordinates. */
  readonly frame: Rect;
  readonly lod: LodBand;
}

export interface CardInstance {
  readonly key: string;
  readonly cardId: string;
  readonly boardId: string;
  readonly boardKey: string;
  readonly path: ScenePath;
  readonly transform: Transform;
  /** Board-space box; portal frames use its size. */
  readonly local: Rect;
  /** Page-space box. */
  readonly rect: Rect;
  readonly z: number;
  readonly lod: LodBand;
  readonly portalKey: string | null;
  readonly title: string | null;
}

export interface SectionInstance {
  readonly key: string;
  readonly sectionId: string;
  readonly boardId: string;
  readonly boardKey: string;
  readonly path: ScenePath;
  readonly transform: Transform;
  readonly local: Rect;
  readonly rect: Rect;
  readonly z: number;
  readonly lod: LodBand;
  readonly title: string;
  readonly color: string | null;
}

export interface EdgeInstance {
  readonly key: string;
  readonly edgeId: string;
  readonly boardId: string;
  readonly boardKey: string;
  readonly path: ScenePath;
  readonly transform: Transform;
  readonly from: Point;
  readonly to: Point;
  /** Page-space bounds of the two endpoints, at least one unit wide/tall. */
  readonly bounds: Rect;
  readonly kind: EdgeKind;
  readonly route: EdgePath;
  readonly label: string | null;
  readonly lod: LodBand;
}

export interface PortalInstance {
  readonly key: string;
  readonly cardId: string;
  readonly boardId: string;
  /** Path of the board that contains the portal card. */
  readonly path: ScenePath;
  /** Depth the child board would have. */
  readonly depth: number;
  readonly transform: Transform;
  readonly localFrame: Rect;
  readonly frame: Rect;
  readonly targetBoardId: string;
  readonly targetBoardName: string | null;
  readonly targetMissing: boolean;
  readonly cycle: boolean;
  readonly depthCapped: boolean;
  readonly expanded: boolean;
  /** True when the surface must render the static miniature instead of a live board. */
  readonly impostor: boolean;
  readonly reason: PortalGateReason;
  readonly gate: PortalGateState;
  /** Target board -> page fit; usable for the impostor preview when collapsed. */
  readonly fit: Transform;
  readonly childKey: string | null;
  readonly lod: LodBand;
  readonly title: string | null;
}

export interface SceneCounts {
  readonly boards: number;
  readonly cards: number;
  readonly sections: number;
  readonly edges: number;
  readonly portals: number;
  readonly expandedPortals: number;
  readonly impostors: number;
  readonly maxDepth: number;
}

export interface Scene {
  readonly rootBoardId: string;
  readonly camera: Camera;
  readonly focusPath: ScenePath;
  readonly root: BoardInstance;
  /** Pre-order: root first, then each expanded board in portal order. */
  readonly boards: readonly BoardInstance[];
  readonly cards: readonly CardInstance[];
  readonly sections: readonly SectionInstance[];
  readonly edges: readonly EdgeInstance[];
  readonly portals: readonly PortalInstance[];
  readonly counts: SceneCounts;
}

/* ----------------------------------------------------------------- outline */

export interface SceneOutlineRow {
  readonly key: string;
  readonly kind: "board" | "portal";
  readonly label: string;
  /** Board the row represents: the instance's board, or a portal's target. */
  readonly boardId: string;
  readonly cardId: string | null;
  readonly path: ScenePath;
  readonly depth: number;
  readonly lod: LodBand;
  readonly expanded: boolean;
  readonly cycle: boolean;
  readonly depthCapped: boolean;
  readonly children: readonly SceneOutlineRow[];
}

/* ----------------------------------------------------------------- surface */

export interface FitBoundsOptions {
  /** Ratio applied to the fitted zoom; 1 fills the viewport. */
  readonly padding?: number;
  readonly maxZoom?: number;
}

export type SurfaceGestureKind = "select" | "drag" | "resize" | "pan" | "zoom" | "activate";

export interface SurfaceGesture {
  readonly kind: SurfaceGestureKind;
  /** Instance key the gesture started on; empty for viewport gestures. */
  readonly instanceKey: string;
  readonly point: Point;
}

/**
 * What an engine adapter must implement. Coordinates: `page` is scene space and
 * `board` is one instance's flow space. The scene never calls into an engine.
 */
export interface SceneSurface {
  setScene(scene: Scene): void;
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  fitBounds(bounds: Rect, options?: FitBoundsOptions): void;
  screenToPage(point: Point): Point;
  pageToScreen(point: Point): Point;
  screenToBoard(instance: BoardInstance, point: Point): Point;
  boardToScreen(instance: BoardInstance, point: Point): Point;
  getSelection(): readonly string[];
  setSelection(ids: readonly string[]): void;
  onGesture?(handler: (gesture: SurfaceGesture) => void): () => void;
}
