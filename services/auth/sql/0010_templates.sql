-- ---------------------------------------------------------------------------
-- 0010 — starter templates, kept where every launcher can reach them
-- ---------------------------------------------------------------------------
--
-- A starter template is the content of a workspace minus the workspace: a few
-- boards, their cards and the pictures inline in those cards. Until now the only
-- starters were the ones compiled into the app, so adding one meant a release and
-- a person without a build could not add one at all.
--
-- The row is the whole template and nothing else: `data` is the JSON
-- `@suite/graph` produces (`captureWorkspaceTemplate`) and `applyWorkspaceTemplate`
-- consumes, stored byte for byte as it was posted. The control plane deliberately
-- does not import `@suite/graph` to check it — that import would drag the Loro WASM
-- build into the account service, which holds no documents. The shape is validated
-- where it is produced, by the client that captured the workspace.
--
-- Pictures ride inline inside `data` as base64 (ADR-0034's rule that a template is
-- self-contained), which is why this table is the one place in this schema where a
-- JSON column is allowed to be megabytes rather than kilobytes.
--
-- `version` is the template's own revision, not a schema version: an operator
-- bumping it is saying "this starter changed", so a launcher that cached the old
-- copy knows to fetch again. It is stored beside `updated_at` rather than derived
-- from it because only the author knows whether a change is worth announcing.
--
-- `name` is what the launcher lists, `description` is what it says underneath, and
-- both are plain text — rendering happens in the client, never here.

CREATE TABLE IF NOT EXISTS templates (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The public list is "every template, by name", so the index is the list's order.
CREATE INDEX IF NOT EXISTS templates_name_idx ON templates (name);
