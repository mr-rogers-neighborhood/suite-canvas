import type { CardType } from "@suite/graph";
import { isBehaviourType } from "@suite/graph";
import {
  type Capability,
  type CommandActions,
  type CommandContext,
  type CommandState,
  commandsFor,
} from "../command/commandRegistry";

/**
 * What a "new thing" surface offers, read from the command registry.
 *
 * Two surfaces offer the same verbs — the dock's pill and the library's Add new —
 * and a verb that reads differently in one of them is a bug nobody can see. So the
 * list, the labels and the availability are assembled once here and rendered twice.
 */
export interface NewThingInput {
  types: CardType[];
  /** Every board, so the portal action can name its targets. */
  boards?: readonly { id: string; name: string }[] | undefined;
  activeBoardId?: string | null | undefined;
  libraryOpen?: boolean | undefined;
  canCreateContent?: boolean | undefined;
  canCreateBoards?: boolean | undefined;
  /** A row appears only when the caller can run it: no handler, no row. */
  handlers: {
    createSketch?: (() => void) | undefined;
    createSection?: (() => void) | undefined;
    createPortal?: ((targetBoardId: string) => void) | undefined;
    createBoardPortal?: (() => void) | undefined;
    /** A board on its own, no portal: the library offers it, the dock has no need. */
    createBoard?: (() => void) | undefined;
  };
}

export interface NewThingMenuModel {
  /** The types a reader authors a card of: never a behaviour, which has its own door. */
  creatableTypes: CardType[];
  sketch: { label: string; run: () => void } | null;
  section: { label: string; run: () => void } | null;
  /** An empty board, offered only where the caller can make one. */
  board: { label: string; run: () => void } | null;
  portal: {
    label: string;
    targets: { key: string; label: string; run: () => void }[];
    /** "New board and portal", offered only to a session that may make boards. */
    newBoard: boolean;
    createBoardPortal: (() => void) | null;
  } | null;
}

export function newThingMenuModel(input: NewThingInput): NewThingMenuModel {
  const {
    types,
    boards = [],
    activeBoardId = null,
    libraryOpen = false,
    canCreateContent = false,
    canCreateBoards = false,
    handlers,
  } = input;

  const commandState: CommandState = {
    workspaceSurface: true,
    readOnly: false,
    paletteOpen: false,
    libraryOpen,
    libraryTab: "cards",
    activeBoardId,
    activeViewId: null,
    cardId: null,
    cardPlaced: false,
    boards: boards.map((board) => ({ id: board.id, name: board.name })),
    views: [],
    sections: [],
    cards: [],
    types: types.map((type) => ({ id: type.id, name: type.name })),
    trashedCount: 0,
  };
  const capabilities: Capability[] = canCreateContent ? ["canCreateContent"] : [];
  const commandContext: CommandContext = {
    capabilities,
    state: commandState,
    // `commandsFor` reads no action while it filters, and the rows rendered for
    // this menu call only these three handlers, so the rest of the table — which
    // belongs to the shell — is not stubbed here.
    actions: {
      createSketch: () => handlers.createSketch?.(),
      createSection: () => handlers.createSection?.(),
      ...(handlers.createPortal ? { createPortalOnBoard: handlers.createPortal } : {}),
    } as CommandActions,
  };
  const canvasCommands = commandsFor("canvas", commandContext);
  const find = (id: string) => canvasCommands.find((command) => command.id === id);

  const sketch = handlers.createSketch === undefined ? undefined : find("card.createSketch");
  const section = handlers.createSection === undefined ? undefined : find("section.create");
  const portal = handlers.createPortal === undefined ? undefined : find("portal.create");
  const portalTargets = portal?.expand?.(commandContext) ?? [];
  const newBoard = canCreateBoards && handlers.createBoardPortal !== undefined;

  return {
    board:
      handlers.createBoard === undefined || !canCreateBoards
        ? null
        : { label: "New board", run: handlers.createBoard },
    creatableTypes: types.filter((type) => !isBehaviourType(type.id)),
    sketch: sketch ? { label: sketch.label, run: () => sketch.run?.(commandContext) } : null,
    section: section ? { label: section.label, run: () => section.run?.(commandContext) } : null,
    portal: portal
      ? {
          label: portal.label,
          targets: portalTargets.map((target) => ({
            key: target.key,
            label: target.label,
            run: () => target.run(commandContext),
          })),
          newBoard,
          createBoardPortal: handlers.createBoardPortal ?? null,
        }
      : null,
  };
}
