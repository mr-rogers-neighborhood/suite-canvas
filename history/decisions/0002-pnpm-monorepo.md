# ADR-0002: pnpm monorepo

- **Status:** accepted
- **Date:** 2026-10-20

## Context

The product spans a canvas client, a collab server, and shared domain code. We need shared
types between client and server without duplication, and fast, cached builds for agent-driven
development.

## Decision

A pnpm workspace monorepo with `apps/*` (canvas, collab-server), `packages/*` (graph), and a
top-level `e2e/` Playwright package. Turborepo caches build/typecheck tasks.

## Consequences

- The typed object graph (`@suite/graph`) is defined once and consumed by the client.
- Package boundaries are explicit; agents must target the right package.
- Slightly more tooling (turbo, workspace scripts) in exchange for cacheable, parallel builds.
