import { type CardType, type FieldKind, fieldKinds } from "@suite/graph";
import type { ErrorCode } from "../../i18n";

/**
 * A type blueprint is a card (ADR-0059).
 *
 * No new object class and no new root map: an ordinary card on a catalog board declares a
 * type in its body. A heading "Fields" starts a list of `Name: kind` lines, and everything
 * above it is the content a new card of that type starts with. An optional `Version: n`
 * line is carried for the reader only — `planBlueprintInstall` explains why the version is
 * not what decides the install.
 *
 * Installing mints **new** field ids. Importing the catalog's ids would give two workspaces
 * the same identity for a field, which is exactly what a merge would confuse.
 */

export interface BlueprintFieldSpec {
  name: string;
  kind: FieldKind;
  required: boolean;
}

export interface BlueprintSpec {
  /** The blueprint card's title, which is the type's name. */
  name: string;
  /** What the catalog card claims; informational, never a copy rule. */
  version: number | null;
  fields: readonly BlueprintFieldSpec[];
  /** The body above the `Fields` heading, as plain paragraphs. */
  starterContent: string;
}

export type BlueprintRead =
  | { ok: true; spec: BlueprintSpec }
  | { ok: false; code: ErrorCode; params: Readonly<Record<string, string | number>> };

interface BodyNode {
  nodeName?: unknown;
  text?: unknown;
  children?: unknown;
}

function isNode(value: unknown): value is BodyNode {
  return typeof value === "object" && value !== null;
}

function childrenOf(node: BodyNode): BodyNode[] {
  return Array.isArray(node.children) ? node.children.filter(isNode) : [];
}

/**
 * The text a node holds, including its inline children.
 *
 * A `loro-prosemirror` body stores an inline run as a bare string in the children list and
 * a text node as `text`, so both shapes have to read as text here.
 */
function textOf(node: BodyNode): string {
  if (typeof node.text === "string") return node.text;
  const children = Array.isArray(node.children) ? node.children : [];
  return children
    .map((child) => {
      if (typeof child === "string") return child;
      return isNode(child) ? textOf(child) : "";
    })
    .join("");
}

const FIELDS_HEADING = "fields";
const VERSION_LINE = /^version:\s*(\d+)$/i;
const FIELD_LINE = /^(?<name>.+?)\s*(?::|\u2014|\u2013|-)\s*(?<kind>[A-Za-z]+)\s*(?<required>\*)?$/;

const EMPTY: BlueprintRead = { ok: false, code: "blueprint.install.empty", params: {} };

/**
 * Reads a blueprint card body, or says why it is not one.
 *
 * Tolerant on purpose: a catalog card is written by a person in an editor, so a missing
 * version line, a stray blank paragraph or a hyphen instead of a colon must not stop an
 * install. What it is not tolerant about is a field kind. A kind this build cannot render is
 * refused by name, because installing it would mint a field nothing displays.
 */
export function readBlueprint(input: {
  title: string | null | undefined;
  /** `peekContent(cardId)?.toJSON()`: the body's plain-JSON form. */
  body: unknown;
}): BlueprintRead {
  const name = input.title?.trim();
  if (!name) return EMPTY;
  if (!isNode(input.body)) return EMPTY;

  const content: string[] = [];
  const fields: BlueprintFieldSpec[] = [];
  let version: number | null = null;
  let inFields = false;

  for (const node of childrenOf(input.body)) {
    const kind = typeof node.nodeName === "string" ? node.nodeName : "";
    const text = textOf(node).trim();

    if (kind === "heading") {
      inFields = text.toLowerCase() === FIELDS_HEADING;
      if (!inFields && text) content.push(text);
      continue;
    }

    if (kind === "bulletList" || kind === "orderedList") {
      if (!inFields) continue;
      for (const item of childrenOf(node)) {
        const parsed = FIELD_LINE.exec(textOf(item).trim());
        if (!parsed?.groups) return EMPTY;
        const fieldName = (parsed.groups.name ?? "").trim();
        const rawKind = (parsed.groups.kind ?? "").trim().toLowerCase();
        if (!(fieldKinds as readonly string[]).includes(rawKind)) {
          return {
            ok: false,
            code: "blueprint.install.unsupported",
            params: { kind: rawKind || "unknown" },
          };
        }
        if (!fieldName) return EMPTY;
        fields.push({
          name: fieldName,
          kind: rawKind as FieldKind,
          required: parsed.groups.required === "*",
        });
      }
      continue;
    }

    if (kind === "paragraph") {
      if (!text) continue;
      const claim = VERSION_LINE.exec(text);
      if (claim?.[1]) {
        version = Number(claim[1]);
        continue;
      }
      if (!inFields) content.push(text);
    }
  }

  if (fields.length === 0 && content.length === 0) return EMPTY;

  return {
    ok: true,
    spec: { name, version, fields, starterContent: content.join("\n\n") },
  };
}

/** Which units of a blueprint an install asks for. Absent means all of them. */
export interface BlueprintInstallParts {
  /** Create the type when no type of that name exists. Defaults to true. */
  type?: boolean | undefined;
  /** Field names to install, or "all". Defaults to all. */
  fields?: readonly string[] | "all" | undefined;
  /** Hand the starter content back for a new card. Defaults to true. */
  starterContent?: boolean | undefined;
}

export interface BlueprintInstallRequest {
  spec: BlueprintSpec;
  /** The type that already carries this blueprint's name, when there is one. */
  existingType: Pick<CardType, "id" | "name" | "fields"> | null;
  parts?: BlueprintInstallParts | undefined;
  /** Field ids come from here; the default is `crypto.randomUUID`. */
  mintId?: (() => string) | undefined;
}

export interface BlueprintInstallPlan {
  /** `install` writes; `up-to-date` has nothing to add; `empty` chose no unit. */
  kind: "install" | "up-to-date" | "empty";
  typeName: string;
  /** True when the caller has to create the type before adding anything to it. */
  createType: boolean;
  addFields: readonly { id: string; spec: BlueprintFieldSpec }[];
  /** Fields the type already declares, by name; their ids and values are kept. */
  reusedFields: readonly string[];
  /** Declared fields the request did not ask for. */
  skippedFields: readonly string[];
  /** The content for a *new* card of this type, or null when none was asked for. */
  starterContent: string | null;
}

/**
 * The install, as data.
 *
 * A version bump is a diff by name, not a replacement: a newer blueprint that declares one
 * more field installs that field and leaves the existing ones alone. Re-minting an id would
 * orphan every value already stored against the old one, and re-adding a field the type
 * already has would show the same property twice. So the declared `version` is for the
 * reader, and the field names decide what the install does.
 *
 * A partial install is the same diff over a smaller set of names: one field, the whole type,
 * or only the starter content are three separate asks, and the plan says which it answered.
 * A request that answers none of them is `empty` rather than an install of nothing.
 */
export function planBlueprintInstall(request: BlueprintInstallRequest): BlueprintInstallPlan {
  const parts = request.parts ?? {};
  const wantsType = parts.type ?? true;
  const wantsContent = parts.starterContent ?? true;
  const chosen = parts.fields ?? "all";
  const mint = request.mintId ?? (() => crypto.randomUUID());
  const existing = request.existingType;

  const have = new Set((existing?.fields ?? []).map((field) => field.name.trim().toLowerCase()));
  const addFields: { id: string; spec: BlueprintFieldSpec }[] = [];
  const reusedFields: string[] = [];
  const skippedFields: string[] = [];

  for (const field of request.spec.fields) {
    const wanted = chosen === "all" || chosen.includes(field.name);
    if (!wanted) {
      skippedFields.push(field.name);
      continue;
    }
    if (have.has(field.name.trim().toLowerCase())) {
      reusedFields.push(field.name);
      continue;
    }
    addFields.push({ id: mint(), spec: field });
  }

  const createType = existing === null && wantsType;
  const content =
    wantsContent && request.spec.starterContent.trim() !== "" ? request.spec.starterContent : null;

  if (addFields.length === 0 && !createType) {
    // The starter content is a copy for a card the caller has yet to make, not a write
    // into the type, so it does not make an install. A request that chose no unit at all
    // is `empty` rather than a successful install of nothing.
    const kind = content === null && existing === null && !wantsType ? "empty" : "up-to-date";
    return {
      kind,
      typeName: request.spec.name,
      createType: false,
      addFields: [],
      reusedFields,
      skippedFields,
      starterContent: content,
    };
  }

  return {
    kind: "install",
    typeName: request.spec.name,
    createType,
    addFields,
    reusedFields,
    skippedFields,
    starterContent: content,
  };
}

/** What an install wrote, so a caller can report it and a test can count it. */
export interface BlueprintInstallResult {
  typeId: string;
  createdType: boolean;
  addedFieldIds: readonly string[];
}

/** The slice of `WorkspaceDocument` an install needs, so a test can hand in a fake. */
export interface BlueprintInstallTarget {
  listTypes(): readonly CardType[];
  createType(input: { name: string }): CardType;
  addField(
    typeId: string,
    input: { name: string; kind: FieldKind; required?: boolean },
  ): { id: string };
}

/**
 * Applies a plan through `WorkspaceDocument`, the only writer.
 *
 * Each step is one graph call: `createType`, then `addField` per field. A caller that wants
 * the install to undo as one step wraps this in `workspace.batch`, which is why this returns
 * ids instead of committing anything of its own.
 */
export function applyBlueprintInstall(
  workspace: BlueprintInstallTarget,
  plan: BlueprintInstallPlan,
): BlueprintInstallResult | null {
  const existing = workspace.listTypes().find((type) => type.name === plan.typeName);

  if (plan.addFields.length === 0 && !plan.createType) {
    return existing ? { typeId: existing.id, createdType: false, addedFieldIds: [] } : null;
  }

  const type = existing ?? workspace.createType({ name: plan.typeName });
  const addedFieldIds: string[] = [];
  for (const entry of plan.addFields) {
    const field = workspace.addField(type.id, {
      name: entry.spec.name,
      kind: entry.spec.kind,
      required: entry.spec.required,
    });
    addedFieldIds.push(field.id);
  }

  return { typeId: type.id, createdType: existing === undefined, addedFieldIds };
}

/** The plain text of a body, for a title or a line the reader wrote. */
function plainText(body: unknown): string {
  if (!isNode(body)) return "";
  return textOf(body).trim();
}

/** Commit origin for one blueprint install, so it undoes in one step. */
export const BLUEPRINT_INSTALL_ORIGIN = "blueprint:install";

/** What a card-backed install needs from the document. */
export interface BlueprintCardTarget extends BlueprintInstallTarget {
  peekTitle(cardId: string): { toJSON(): unknown } | null;
  peekContent(cardId: string): { toJSON(): unknown } | null;
  batch<T>(origin: string, fn: () => T): T;
}

export interface BlueprintCardInstall {
  /** What the card declared, including the reason it declared nothing. */
  blueprint: BlueprintRead;
  /** The diff, or null when the card is not a blueprint. */
  plan: BlueprintInstallPlan | null;
  /** Null when there was nothing to write, which the plan already explains. */
  result: BlueprintInstallResult | null;
}

/**
 * Installs the blueprint on one card, end to end.
 *
 * The title is the type's name and the body carries the declaration, so this reads both
 * through the document and then applies the plan in one batch. A card that is not a
 * blueprint returns the reason rather than writing anything, and a plan with nothing to add
 * returns no result: an install that wrote nothing should be sayable.
 */
export function installBlueprintCard(
  workspace: BlueprintCardTarget,
  cardId: string,
  parts?: BlueprintInstallParts,
): BlueprintCardInstall {
  const title = plainText(workspace.peekTitle(cardId)?.toJSON() ?? null);
  const read = readBlueprint({ title, body: workspace.peekContent(cardId)?.toJSON() ?? null });
  if (!read.ok) return { blueprint: read, plan: null, result: null };

  const existingType = workspace.listTypes().find((type) => type.name === read.spec.name) ?? null;
  const plan = planBlueprintInstall({ spec: read.spec, existingType, parts });
  if (plan.kind !== "install") return { blueprint: read, plan, result: null };

  const result = workspace.batch(BLUEPRINT_INSTALL_ORIGIN, () =>
    applyBlueprintInstall(workspace, plan),
  );
  return { blueprint: read, plan, result };
}
