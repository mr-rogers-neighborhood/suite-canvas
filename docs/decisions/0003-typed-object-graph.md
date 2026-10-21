# ADR-0003: Typed object graph via Zod-validated Yjs wrapper

- **Status:** accepted
- **Date:** 2026-10-20

## Context

The document is a CRDT of untyped Yjs maps. We want a **typed object graph** (nodes + semantic
edges) that is safe to evolve and cheap for AI agents to reason about.

## Decision

`@suite/graph` owns the schema as Zod discriminated unions (`GraphNode`, `GraphEdge`) and
exposes `GraphDocument`, a typed wrapper that validates every write and emits typed change
events. Raw Yjs access outside this package is prohibited.

## Consequences

- Invalid data cannot enter the CRDT; consumers get typed snapshots.
- Schema evolution is centralized and testable.
- New graph operations require a change in `@suite/graph` (a small, deliberate step).
