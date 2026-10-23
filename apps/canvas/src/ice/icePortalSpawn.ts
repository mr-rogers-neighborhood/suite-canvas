/**
 * Lane D: the ICE portal spawn adapter.
 *
 * `icePortals.ts` answers *what* the portal graph looks like. This module
 * answers *in which order* the surface spawns it, and keeps the identity the
 * surface needs afterwards to resolve a pick back to a canonical card.
 *
 * ## The step list
 *
 * A `PortalSpawnPlan` is one flat, ordered list of `PortalSpawnStep`s: one
 * `container` per board instance, plus that instance's sections, edges and
 * stubs. Ordering is fixed and derived from the plan alone:
 *
 * 1. containers follow `IcePortalPlan.instances` pre-order, so a parent is
 *    always spawned before its children and `parent` can be passed on the
 *    child's spawn options;
 * 2. a container is followed by its own subtree, then by that instance's
 *    sections, edges and stubs, sorted with `compareIcePaint` (sections, then
 *    edges, then stubs; `z`, then key inside a layer).
 *
 * Rule 2 is what the surface needs for paint order inside one container: a
 * board's sections exist before its edges, and a stub is the last thing put
 * into its container, so nothing paints over a door that refused to open.
 * Every step carries the page-space `box` it occupies, so a caller spawns at
 * `{ x, y, w, h }` without re-deriving geometry.
 *
 * ## What this module does not do
 *
 * No ICE import, no React, no widget call of any kind: `PortalSpawner` is the
 * same two-door structural interface `spawnIceSuite` uses (`spawn`, `project`),
 * and the four type names arrive through `PortalSpawnKinds`. The lead owns
 * `spawnWidget`/`step`, `enterContainer`/`exitContainer` and every camera
 * choice. Nothing here writes to the graph, and nothing is persisted.
 *
 * The module is pure: it reads the plan, never mutates it, sorts copies, and
 * returns the same steps for the same plan every time.
 */
import type { EdgeKind, EdgePath } from "@suite/graph";
import type { Point, Rect } from "@suite/scene";
import {
  compareIcePaint,
  type IceBoardInstancePlan,
  type IceEdgePlan,
  type IcePortalPlan,
  type IcePortalStopReason,
  type IcePortalStubPlan,
  type IceSectionPlan,
  iceInstanceKey,
} from "./icePortals";

/* ------------------------------------------------------------------- boxes */

/** The page-space box a step occupies; the spawner reads `{ x, y, w, h }`. */
export interface PortalSpawnBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function boxOf(rect: Rect): PortalSpawnBox {
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
}

/* ------------------------------------------------------------------- steps */

export type PortalSpawnKind = "container" | "section" | "edge" | "stub";

interface PortalSpawnStepBase {
  /** Unique step key: the instance key, or the descriptor key. */
  readonly key: string;
  /** Instance whose container owns this step. */
  readonly instanceKey: string;
  /** Canonical board the step paints into. */
  readonly boardId: string;
  /** Depth of the owning instance; the root is 0. */
  readonly depth: number;
  /** Board ids from the root down to the owning instance. */
  readonly path: readonly string[];
  /** Page-space box to spawn at. */
  readonly box: PortalSpawnBox;
}

/** One board instance: spawn it as the container the children go inside. */
export interface PortalContainerSpawnStep extends PortalSpawnStepBase {
  readonly kind: "container";
  readonly boardName: string;
  /** Instance key of the containing instance; `null` at the root. */
  readonly parentKey: string | null;
  /** Canonical portal card that opened it; `null` at the root. */
  readonly portalCardId: string | null;
  /** Canonical `boardId/cardId` placement that opened it; `null` at the root. */
  readonly placementId: string | null;
  /** Container box in page space: the portal card's rect, or the root bounds. */
  readonly frame: Rect;
  /** Fitted content extent inside `frame`, in page space. */
  readonly rect: Rect;
}

export interface PortalSectionSpawnStep extends PortalSpawnStepBase {
  readonly kind: "section";
  readonly sectionId: string;
  readonly title: string;
  readonly color: string | null;
  readonly z: number;
  /** Page-space section box. */
  readonly rect: Rect;
  /** The owning instance's frame; the descriptor clips to it. */
  readonly clip: Rect;
}

export interface PortalEdgeSpawnStep extends PortalSpawnStepBase {
  readonly kind: "edge";
  readonly edgeId: string;
  /** The graph edge kind (`relates-to`, …), not the step kind. */
  readonly edgeKind: EdgeKind;
  readonly route: EdgePath;
  readonly bidirectional: boolean;
  readonly label: string | null;
  readonly labelOffset: number | null;
  /** Page-space anchors. */
  readonly from: Point;
  readonly to: Point;
  /** Page-space bounds of the two anchors. */
  readonly bounds: Rect;
  readonly clip: Rect;
  readonly z: number;
}

/** A portal that must not open; it spawns after the instance's children. */
export interface PortalStubSpawnStep extends PortalSpawnStepBase {
  readonly kind: "stub";
  readonly portalCardId: string;
  readonly placementId: string;
  readonly reason: IcePortalStopReason;
  readonly targetBoardId: string;
  readonly targetBoardName: string | null;
  /** Depth the refused target board would have had. */
  readonly targetDepth: number;
  /** Human label for the door: the target name, or "Unavailable board". */
  readonly label: string;
  /** The portal card's page-space box: where the stub is painted. */
  readonly frame: Rect;
  readonly clip: Rect;
  readonly z: number;
}

export type PortalSpawnStep =
  | PortalContainerSpawnStep
  | PortalSectionSpawnStep
  | PortalEdgeSpawnStep
  | PortalStubSpawnStep;

type IceInstanceDescriptor = IceSectionPlan | IceEdgePlan | IcePortalStubPlan;

/* -------------------------------------------------------------- identities */

/** Canonical identity behind one instance key; the reverse lookups live below. */
export interface PortalInstanceIdentity {
  readonly instanceKey: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly depth: number;
  /** Portal card that opened this instance; `null` at the root. */
  readonly portalCardId: string | null;
  readonly placementId: string | null;
  readonly parentKey: string | null;
  readonly path: readonly string[];
}

/**
 * Instance key → identity, plus the two reverse lookups a pick needs:
 * which instances one portal card opened, and where one canonical board is.
 */
export interface InstanceIdentityMap {
  readonly rootKey: string;
  readonly instances: ReadonlyMap<string, PortalInstanceIdentity>;
  /** Every instance a portal card opened, in pre-order. Empty for plain cards. */
  readonly cardInstances: (portalCardId: string) => readonly PortalInstanceIdentity[];
  /** Every instance of one canonical board; more than one is multi-placement. */
  readonly instancesOfBoard: (boardId: string) => readonly PortalInstanceIdentity[];
}

function appendIdentity(
  index: Map<string, PortalInstanceIdentity[]>,
  id: string,
  identity: PortalInstanceIdentity,
): void {
  const bucket = index.get(id);
  if (bucket) bucket.push(identity);
  else index.set(id, [identity]);
}

export function buildInstanceIdentityMap(plan: IcePortalPlan): InstanceIdentityMap {
  const instances = new Map<string, PortalInstanceIdentity>();
  const byCard = new Map<string, PortalInstanceIdentity[]>();
  const byBoard = new Map<string, PortalInstanceIdentity[]>();

  for (const instance of plan.instances) {
    const identity: PortalInstanceIdentity = {
      instanceKey: instance.key,
      boardId: instance.boardId,
      boardName: instance.boardName,
      depth: instance.depth,
      portalCardId: instance.portalCardId,
      placementId: instance.placementId,
      parentKey: instance.parentKey,
      path: instance.path,
    };
    instances.set(identity.instanceKey, identity);
    if (identity.portalCardId !== null) appendIdentity(byCard, identity.portalCardId, identity);
    appendIdentity(byBoard, identity.boardId, identity);
  }

  return {
    rootKey: iceInstanceKey(null, plan.rootBoardId, null),
    instances,
    cardInstances: (portalCardId) => byCard.get(portalCardId) ?? [],
    instancesOfBoard: (boardId) => byBoard.get(boardId) ?? [],
  };
}

/* -------------------------------------------------------------------- plan */

/** The read side `portalFocusTarget` needs; both plan shapes satisfy it. */
export interface PortalFocusSource {
  readonly instances: readonly IceBoardInstancePlan[];
  readonly stubs: readonly IcePortalStubPlan[];
}

export interface PortalSpawnCounts {
  readonly containers: number;
  readonly sections: number;
  readonly edges: number;
  readonly stubs: number;
}

export interface PortalSpawnPlan extends PortalFocusSource {
  readonly rootBoardId: string;
  readonly rootKey: string;
  readonly maxDepth: number;
  /** Every step, already in spawn order. */
  readonly steps: readonly PortalSpawnStep[];
  readonly counts: PortalSpawnCounts;
  readonly identities: InstanceIdentityMap;
}

function containerStep(instance: IceBoardInstancePlan): PortalContainerSpawnStep {
  return {
    kind: "container",
    key: instance.key,
    instanceKey: instance.key,
    boardId: instance.boardId,
    boardName: instance.boardName,
    depth: instance.depth,
    path: instance.path,
    parentKey: instance.parentKey,
    portalCardId: instance.portalCardId,
    placementId: instance.placementId,
    frame: instance.frame,
    rect: instance.rect,
    box: boxOf(instance.frame),
  };
}

function descriptorStep(
  descriptor: IceInstanceDescriptor,
  instance: IceBoardInstancePlan,
): PortalSectionSpawnStep | PortalEdgeSpawnStep | PortalStubSpawnStep {
  if (descriptor.layer === "section") {
    return {
      kind: "section",
      key: descriptor.key,
      instanceKey: descriptor.instanceKey,
      boardId: descriptor.boardId,
      depth: instance.depth,
      path: descriptor.path,
      sectionId: descriptor.sectionId,
      title: descriptor.title,
      color: descriptor.color,
      z: descriptor.z,
      rect: descriptor.rect,
      clip: descriptor.clip,
      box: boxOf(descriptor.rect),
    };
  }
  if (descriptor.layer === "edge") {
    return {
      kind: "edge",
      key: descriptor.key,
      instanceKey: descriptor.instanceKey,
      boardId: descriptor.boardId,
      depth: instance.depth,
      path: descriptor.path,
      edgeId: descriptor.edgeId,
      edgeKind: descriptor.kind,
      route: descriptor.route,
      bidirectional: descriptor.bidirectional,
      label: descriptor.label,
      labelOffset: descriptor.labelOffset,
      from: descriptor.from,
      to: descriptor.to,
      bounds: descriptor.bounds,
      clip: descriptor.clip,
      z: descriptor.z,
      box: boxOf(descriptor.bounds),
    };
  }
  return {
    kind: "stub",
    key: descriptor.key,
    instanceKey: descriptor.instanceKey,
    boardId: descriptor.boardId,
    depth: instance.depth,
    path: descriptor.path,
    portalCardId: descriptor.portalCardId,
    placementId: descriptor.placementId,
    reason: descriptor.reason,
    targetBoardId: descriptor.targetBoardId,
    targetBoardName: descriptor.targetBoardName,
    targetDepth: descriptor.depth,
    label: descriptor.label,
    frame: descriptor.frame,
    clip: descriptor.clip,
    z: descriptor.z,
    box: boxOf(descriptor.frame),
  };
}

/**
 * Turns the portal plan into the ordered spawn list.
 *
 * Containers keep `IcePortalPlan.instances` pre-order; each instance's own
 * sections/edges/stubs follow its subtree in paint order. The input plan is
 * read only.
 */
export function planPortalSpawns(plan: IcePortalPlan): PortalSpawnPlan {
  const children = new Map<string, IceBoardInstancePlan[]>();
  for (const instance of plan.instances) {
    if (instance.parentKey === null) continue;
    const bucket = children.get(instance.parentKey);
    if (bucket) bucket.push(instance);
    else children.set(instance.parentKey, [instance]);
  }

  const descriptors = new Map<string, IceInstanceDescriptor[]>();
  const addDescriptor = (instanceKey: string, descriptor: IceInstanceDescriptor): void => {
    const bucket = descriptors.get(instanceKey);
    if (bucket) bucket.push(descriptor);
    else descriptors.set(instanceKey, [descriptor]);
  };
  for (const section of plan.sections) addDescriptor(section.instanceKey, section);
  for (const edge of plan.edges) addDescriptor(edge.instanceKey, edge);
  for (const stub of plan.stubs) addDescriptor(stub.instanceKey, stub);
  for (const bucket of descriptors.values()) bucket.sort(compareIcePaint);

  const steps: PortalSpawnStep[] = [];
  const counts = { containers: 0, sections: 0, edges: 0, stubs: 0 };

  const visit = (instance: IceBoardInstancePlan): void => {
    steps.push(containerStep(instance));
    counts.containers += 1;
    for (const child of children.get(instance.key) ?? []) visit(child);
    for (const descriptor of descriptors.get(instance.key) ?? []) {
      const step = descriptorStep(descriptor, instance);
      if (step.kind === "section") counts.sections += 1;
      else if (step.kind === "edge") counts.edges += 1;
      else counts.stubs += 1;
      steps.push(step);
    }
  };

  const root = plan.instances.find((instance) => instance.parentKey === null);
  if (root !== undefined) visit(root);

  return {
    rootBoardId: plan.rootBoardId,
    rootKey: iceInstanceKey(null, plan.rootBoardId, null),
    maxDepth: plan.maxDepth,
    steps,
    counts,
    identities: buildInstanceIdentityMap(plan),
    instances: plan.instances,
    stubs: plan.stubs,
  };
}

/* ----------------------------------------------------------------- spawner */

/** The slice of ICE's `SpawnWidgetOpts` this adapter fills. */
export interface PortalSpawnOptions<TEntity> {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly props?: Readonly<Record<string, unknown>> | undefined;
  readonly parent?: TEntity | undefined;
  readonly undoable?: boolean | undefined;
}

/** The two doors the spawner needs; structural, so tests pass a recorder. */
export interface PortalSpawner<TEntity> {
  spawn(type: string, opts: PortalSpawnOptions<TEntity>): TEntity;
  /** Advance the engine: register the root frame, compile a container. */
  project(): void;
}

/** The engine-side type names; the names stay the caller's choice. */
export interface PortalSpawnKinds {
  readonly board: string;
  readonly section: string;
  readonly edge: string;
  readonly stub: string;
}

export type PortalSpawnInput = IcePortalPlan | PortalSpawnPlan;

export interface PortalSpawnReport<TEntity> {
  readonly seeded: number;
  /** Spawned type names, in spawn order. */
  readonly kinds: readonly string[];
  readonly failures: readonly string[];
  /** Instance key → container entity, in spawn order. */
  readonly entities: ReadonlyMap<string, TEntity>;
  /** Board id → every container entity of it; two entries is multi-placement. */
  readonly boards: ReadonlyMap<string, readonly TEntity[]>;
  /** Step key → entity, per descriptor kind. */
  readonly sections: ReadonlyMap<string, TEntity>;
  readonly edges: ReadonlyMap<string, TEntity>;
  readonly stubs: ReadonlyMap<string, TEntity>;
  /** The plan that was actually spawned. */
  readonly plan: PortalSpawnPlan;
}

function isSpawnPlan(value: PortalSpawnInput): value is PortalSpawnPlan {
  return "steps" in value;
}

/**
 * One key → entity map over every spawned step: container instance keys plus
 * section/edge/stub step keys. This is the map `portalFocusTarget` wants when a
 * stub is focused; `report.entities` alone holds containers only.
 */
export function spawnReportEntities<TEntity>(
  report: PortalSpawnReport<TEntity>,
): Map<string, TEntity> {
  const entities = new Map<string, TEntity>(report.entities);
  for (const [key, entity] of report.sections) entities.set(key, entity);
  for (const [key, entity] of report.edges) entities.set(key, entity);
  for (const [key, entity] of report.stubs) entities.set(key, entity);
  return entities;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}

function typeOf(step: PortalSpawnStep, kinds: PortalSpawnKinds): string {
  switch (step.kind) {
    case "container":
      return kinds.board;
    case "section":
      return kinds.section;
    case "edge":
      return kinds.edge;
    case "stub":
      return kinds.stub;
  }
}

function propsFor(step: PortalSpawnStep): Readonly<Record<string, unknown>> {
  switch (step.kind) {
    case "container":
      return {
        instanceKey: step.instanceKey,
        boardId: step.boardId,
        boardName: step.boardName,
        depth: step.depth,
        portalCardId: step.portalCardId,
        placementId: step.placementId,
        path: step.path,
      };
    case "section":
      return {
        instanceKey: step.instanceKey,
        boardId: step.boardId,
        sectionId: step.sectionId,
        title: step.title,
        color: step.color,
        depth: step.depth,
        clip: step.clip,
      };
    case "edge":
      return {
        instanceKey: step.instanceKey,
        boardId: step.boardId,
        edgeId: step.edgeId,
        edgeKind: step.edgeKind,
        route: step.route,
        bidirectional: step.bidirectional,
        label: step.label,
        labelOffset: step.labelOffset,
        from: step.from,
        to: step.to,
        depth: step.depth,
        clip: step.clip,
      };
    case "stub":
      return {
        instanceKey: step.instanceKey,
        boardId: step.boardId,
        portalCardId: step.portalCardId,
        placementId: step.placementId,
        reason: step.reason,
        label: step.label,
        targetBoardId: step.targetBoardId,
        targetBoardName: step.targetBoardName,
        targetDepth: step.targetDepth,
        depth: step.depth,
        clip: step.clip,
      };
  }
}

function optionsFor<TEntity>(
  step: PortalSpawnStep,
  parent: TEntity | undefined,
): PortalSpawnOptions<TEntity> {
  const options: PortalSpawnOptions<TEntity> = {
    x: step.box.x,
    y: step.box.y,
    w: step.box.w,
    h: step.box.h,
    props: propsFor(step),
    undoable: false,
  };
  return parent === undefined ? options : { ...options, parent };
}

/**
 * Spawns an ordered portal plan through an engine.
 *
 * Parents precede children, so a child always receives its container as
 * `parent`; `project()` runs once for the root frame and after every container,
 * which is the lifecycle `spawnIceSuite` uses. A refused spawn is recorded and
 * the walk continues: its descendants report the missing container instead.
 */
export function spawnIcePortals<TEntity>(
  input: PortalSpawnInput,
  spawner: PortalSpawner<TEntity>,
  kinds: PortalSpawnKinds,
): PortalSpawnReport<TEntity> {
  const plan = isSpawnPlan(input) ? input : planPortalSpawns(input);
  const entities = new Map<string, TEntity>();
  const boards = new Map<string, TEntity[]>();
  const sections = new Map<string, TEntity>();
  const edges = new Map<string, TEntity>();
  const stubs = new Map<string, TEntity>();
  const spawnedKinds: string[] = [];
  const failures: string[] = [];
  let seeded = 0;

  const project = (): void => {
    try {
      spawner.project();
    } catch (error) {
      failures.push(`projection: ${describeError(error)}`);
    }
  };

  const record = (step: PortalSpawnStep, entity: TEntity): void => {
    if (step.kind === "container") {
      entities.set(step.instanceKey, entity);
      const bucket = boards.get(step.boardId);
      if (bucket) bucket.push(entity);
      else boards.set(step.boardId, [entity]);
      return;
    }
    if (step.kind === "section") sections.set(step.key, entity);
    else if (step.kind === "edge") edges.set(step.key, entity);
    else stubs.set(step.key, entity);
  };

  project();

  for (const step of plan.steps) {
    // A container's parent is another container; a descriptor's parent is the
    // container of its own instance.
    const owner = step.kind === "container" ? step.parentKey : step.instanceKey;
    const parent = owner === null ? undefined : entities.get(owner);
    if (owner !== null && parent === undefined) {
      failures.push(`${step.kind}:${step.key} — its container ${owner} did not spawn.`);
      continue;
    }

    const type = typeOf(step, kinds);
    try {
      const entity = spawner.spawn(type, optionsFor(step, parent));
      seeded += 1;
      spawnedKinds.push(type);
      record(step, entity);
      // A container's inside frame is compiled before anything is put in it.
      if (step.kind === "container") project();
    } catch (error) {
      failures.push(`${step.kind}:${step.key} (${type}): ${describeError(error)}`);
    }
  }

  return {
    seeded,
    kinds: spawnedKinds,
    failures,
    entities,
    boards,
    sections,
    edges,
    stubs,
    plan,
  };
}

/* ----------------------------------------------------------- focus targets */

/** One crumb of the label chain, root first. */
export interface PortalBreadcrumb {
  readonly instanceKey: string;
  readonly boardId: string;
  readonly label: string;
  readonly depth: number;
}

/**
 * What ICE's `enterContainer` / `exitContainer` (and a stub's focus action)
 * needs. No camera call is made here.
 */
export interface PortalFocusTarget<TEntity> {
  readonly kind: "instance" | "stub";
  /** Instance key, or the stub's step key. */
  readonly key: string;
  /** Instance whose container owns the target; the stub's instance for a stub. */
  readonly instanceKey: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly depth: number;
  /** Board name, or the stub's label. */
  readonly label: string;
  /** Board names from the root down to the target, root first. */
  readonly breadcrumbs: readonly PortalBreadcrumb[];
  /** Entity to `enterContainer`; `null` for a stub, which is framed instead. */
  readonly container: TEntity | null;
  /** Container to `exitContainer` back to; `null` at the root. */
  readonly parentKey: string | null;
  /** The stub entity to frame; `null` for an instance. */
  readonly stub: TEntity | null;
  readonly reason: IcePortalStopReason | null;
  readonly targetBoardId: string | null;
  readonly targetBoardName: string | null;
  /** Page-space box to frame: the container's frame, or the stub's card. */
  readonly box: PortalSpawnBox;
}

function breadcrumbChain(
  instances: ReadonlyMap<string, IceBoardInstancePlan>,
  target: IceBoardInstancePlan,
): PortalBreadcrumb[] {
  const chain: PortalBreadcrumb[] = [];
  let cursor: IceBoardInstancePlan | undefined = target;
  while (cursor !== undefined) {
    chain.unshift({
      instanceKey: cursor.key,
      boardId: cursor.boardId,
      label: cursor.boardName,
      depth: cursor.depth,
    });
    cursor = cursor.parentKey === null ? undefined : instances.get(cursor.parentKey);
  }
  return chain;
}

/**
 * Resolves an instance key or a stub step key into the data ICE needs.
 *
 * `entities` is the spawn report's map (or any instance/stub key → entity map);
 * omit it when only the identity and breadcrumbs matter. Returns `null` for a
 * key the plan does not contain.
 */
export function portalFocusTarget<TEntity = never>(
  source: PortalFocusSource,
  ref: string,
  entities?: ReadonlyMap<string, TEntity>,
): PortalFocusTarget<TEntity> | null {
  const instances = new Map<string, IceBoardInstancePlan>();
  for (const instance of source.instances) instances.set(instance.key, instance);

  const stub = source.stubs.find((entry) => entry.key === ref);
  if (stub !== undefined) {
    const owner = instances.get(stub.instanceKey);
    if (owner === undefined) return null;
    return {
      kind: "stub",
      key: stub.key,
      instanceKey: stub.instanceKey,
      boardId: stub.boardId,
      boardName: owner.boardName,
      depth: stub.depth,
      label: stub.label,
      breadcrumbs: [
        ...breadcrumbChain(instances, owner),
        {
          instanceKey: stub.key,
          boardId: stub.targetBoardId,
          label: stub.label,
          depth: stub.depth,
        },
      ],
      container: null,
      parentKey: stub.instanceKey,
      stub: entities?.get(stub.key) ?? null,
      reason: stub.reason,
      targetBoardId: stub.targetBoardId,
      targetBoardName: stub.targetBoardName,
      box: boxOf(stub.frame),
    };
  }

  const instance = instances.get(ref);
  if (instance === undefined) return null;
  return {
    kind: "instance",
    key: instance.key,
    instanceKey: instance.key,
    boardId: instance.boardId,
    boardName: instance.boardName,
    depth: instance.depth,
    label: instance.boardName,
    breadcrumbs: breadcrumbChain(instances, instance),
    container: entities?.get(instance.key) ?? null,
    parentKey: instance.parentKey,
    stub: null,
    reason: null,
    targetBoardId: null,
    targetBoardName: null,
    box: boxOf(instance.frame),
  };
}
