# ADR-0044: One target primitive

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0005](./0005-flow-space-presence.md), [ADR-0009](./0009-live-drag-presence.md), [ADR-0018](./0018-orientation-and-multi-object.md), [ADR-0041](./0041-alpha-core-is-a-closed-feature-set.md), [ADR-0045](./0045-handbook-articles-are-cards.md), [`apps/canvas/src/collab/presence.ts`](../../apps/canvas/src/collab/presence.ts)

## Context

Four features in the core list are, underneath, the same sentence: **"here is the thing I mean."**

- **Presence** already publishes what a peer has selected and where their pointer is.
- **Follow** means "show me what that person is looking at".
- **Goto** means "take me to the thing named in this chat message or link".
- **The handbook** must outline, on screen, the element an article is describing.

Today presence carries `nodeIds`, `edgeIds`, a `sectionId` and a `connector`. The handbook would need a
field, a rect, or a library row. Chat links need to name a card, a board or a section. Four payloads
with four notions of "target" is how one of them ends up unable to point at sections.

## Decision

**One target primitive, addressed by every surface that means "this thing".**

```ts
interface Target {
  kind: "card" | "board" | "section" | "edge" | "field" | "attachment" | "ui";
  id: string;
  /** A field on the target, when the target is a specific property. */
  fieldId?: string;
  /** A sub-range: an annotation's page or timecode, a text range, a rect. */
  range?: { start: number; end: number } | { x: number; y: number; width: number; height: number };
  /** The board the target is on right now, so a receiver can navigate first. */
  boardId?: string;
}
```

1. **Presence carries a `Target`.** Selection is the set of node and edge targets already there; a
   connector, a section and a field are the same shape with a different `kind`.
2. **Follow is a subscription to a peer's `Target`.** It reads presence; it stores nothing.
3. **Goto is navigation to a `Target`.** It resolves through the existing camera/board machinery
   (`viewportRequest`, board tabs, portal entry) and never invents a second router.
4. **The handbook highlights a `Target`.** An article says which `kind` it documents; the canvas outlines
   the *closest* matching instance on screen (nearest to the viewport centre when several match).
5. **The primitive is UI state.** A `Target` is ephemeral — published on presence or held in a store —
   and is never written to the document. A document-level pointer (a link, a mention, a `card` or
   `board` field) stays what ADR-0019 says it is.
6. **`kind` is closed and additive.** Adding a kind is an explicit edit to this ADR, because every
   consumer must decide how it navigates and how it outlines.

## Rejected alternatives

- **Per-feature payloads.** Four shapes, four resolvers, and a handbook that cannot outline a connector
  because presence never named one.
- **Write follow/goto state to the document.** Two people following each other would fight over a
  shared field, and a reload would resume a stale cursor. It is view state.
- **A URL router for Goto.** The app has board tabs and a camera, not routes; a router would be a second
  navigation model next to portals.
- **Let the handbook match by DOM selector.** Selectors break on refactor and cannot be authored by a
  user writing an article.

## Consequences

- **Presence payloads are refactored onto `Target`.** The existing fields (`nodeIds`, `edgeIds`,
  `sectionId`, `connector`) become targets with kinds; the wire format changes once, with a version
  guard.
- **Chat messages can carry a target**, so "look at this" is a click rather than a description. Chat
  itself is persisted; the target inside it is just data.
- **The handbook and Follow share one resolver**, so "outline what I am being shown" works the same
  whether the source is an article or a colleague.
- **`ui` is a real kind.** The handbook must be able to document chrome (the library button, the sync
  indicator) and the inspector-picker mode selects chrome by the same primitive.
- **A permission rule is required.** A target may point at something the receiver cannot see (a card on
  another board, a share-scoped board); resolution must fail quietly rather than navigate out of scope.
