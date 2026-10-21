# ADR-0001: Yjs as the single source of truth

- **Status:** accepted
- **Date:** 2026-10-20

## Context

The app must be local-first (offline-capable) and collaborative. Options were:

- A classic client/server API with a local cache (hard to reconcile offline edits).
- A plain IndexedDB store (Dexie) with manual sync.
- A CRDT (Yjs) that is both the local store and the sync protocol.

## Decision

Yjs is the single source of truth for document state. The document persists offline via
`y-indexeddb` and syncs through Hocuspocus. A typed layer (`@suite/graph`) wraps the Yjs doc.

## Consequences

- Offline edits and multi-user edits converge without custom conflict resolution.
- We do not adopt Dexie/idb; all persistence is `y-indexeddb`.
- The UI must observe CRDT changes rather than own state (enforced by conventions).
