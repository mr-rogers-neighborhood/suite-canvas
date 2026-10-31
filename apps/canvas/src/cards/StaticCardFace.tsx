import {
  type ContainerID,
  getType,
  isContainer,
  type LoroDoc,
  LoroList,
  LoroMap,
  LoroText,
} from "loro-crdt";
import { type CSSProperties, Fragment, type ReactNode, useEffect, useState } from "react";
import { ATTACHMENT_ID_PATTERN, attachmentUrl } from "../editor/attachmentNode";
import { BODY_PLACEHOLDER } from "./CardBodyEditor";

function isMap(value: unknown): value is LoroMap {
  return value instanceof LoroMap || (isContainer(value) && getType(value) === "Map");
}

function isList(value: unknown): value is LoroList {
  return value instanceof LoroList || (isContainer(value) && getType(value) === "List");
}

function isText(value: unknown): value is LoroText {
  return value instanceof LoroText || (isContainer(value) && getType(value) === "Text");
}

function getAttr(map: LoroMap, key: string): unknown {
  const attrs = map.get("attributes");
  if (isMap(attrs)) return attrs.get(key);
  if (attrs && typeof attrs === "object" && key in attrs) {
    return (attrs as Record<string, unknown>)[key];
  }
  return map.get(key);
}

function getChildren(map: LoroMap): unknown[] {
  const children = map.get("children");
  if (isList(children)) return children.toArray();
  return [];
}

function renderDelta(text: LoroText, keyPrefix: string): ReactNode {
  const delta = text.toDelta();
  if (!delta || delta.length === 0) return null;

  return delta.map((d, index) => {
    const str = d.insert;
    if (str == null) return null;
    const attrs = d.attributes;

    let node: ReactNode = str;

    if (attrs?.code != null) {
      node = <code>{node}</code>;
    }
    if (attrs?.bold != null) {
      node = <strong>{node}</strong>;
    }
    if (attrs?.italic != null) {
      node = <em>{node}</em>;
    }
    if (attrs?.strike != null) {
      node = <s>{node}</s>;
    }
    if (attrs?.underline != null) {
      node = <u>{node}</u>;
    }
    if (attrs?.link != null && typeof attrs.link === "object" && "href" in attrs.link) {
      const href = String((attrs.link as { href?: string }).href ?? "");
      node = (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-[var(--accent)] hover:opacity-80"
          onClick={(e) => e.stopPropagation()}
        >
          {node}
        </a>
      );
    }

    // biome-ignore lint/suspicious/noArrayIndexKey: text deltas are position-ordered text segments without stable identity.
    return <Fragment key={`${keyPrefix}-${index}`}>{node}</Fragment>;
  });
}

function renderInlineChild(child: unknown, key: string): ReactNode {
  if (isText(child)) {
    return renderDelta(child, key);
  }
  if (typeof child === "string") {
    return child;
  }
  if (isMap(child)) {
    const nodeName = child.get("nodeName");
    if (nodeName === "mention") {
      const cardId = String(getAttr(child, "cardId") ?? "");
      const label = String(getAttr(child, "label") ?? cardId);
      return (
        <span
          key={key}
          className="mention-chip inline-flex items-center gap-0.5 rounded px-1 text-[12px] bg-[var(--accent-tint,#e0e7ff)] text-[var(--accent,#4338ca)]"
        >
          @{label || "card"}
        </span>
      );
    }
    if (nodeName === "hardBreak") {
      return <br key={key} />;
    }
    const children = getChildren(child);
    if (children.length > 0) {
      return (
        <Fragment key={key}>
          {children.map((grandChild, idx) => renderInlineChild(grandChild, `${key}-${idx}`))}
        </Fragment>
      );
    }
  }
  return null;
}

/** Which renderer a media-ish block wants, without the editor's node factory. */
function staticMediaKind(block: LoroMap, nodeName: string): "image" | "video" | "youtube" {
  if (nodeName === "media") {
    const kind = getAttr(block, "kind");
    return kind === "video" || kind === "youtube" ? kind : "image";
  }
  if (nodeName === "image") return "image";
  if (nodeName === "video") return "video";
  if (nodeName === "youtube") return "youtube";
  // A legacy `attachment` carried images and videos alike; the mime is the only
  // thing that says which, and it is the same rule the lazy migration uses.
  return String(getAttr(block, "mime") ?? "").startsWith("video/") ? "video" : "image";
}

function sized(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Where the bytes are: the relay by id, or the address the node names itself. */
function mediaSource(block: LoroMap): string | null {
  const id = getAttr(block, "id");
  if (typeof id === "string" && ATTACHMENT_ID_PATTERN.test(id)) return attachmentUrl(id);
  const src = getAttr(block, "src");
  return typeof src === "string" && src.length > 0 ? src : null;
}

/** A box the picture can fill, so a lazy load never reflows the card. */
function reservedBox(width: number | null, height: number | null): CSSProperties | undefined {
  if (width === null || height === null) return undefined;
  return { aspectRatio: `${String(width)} / ${String(height)}`, width: "100%", height: "auto" };
}

/**
 * A media block, drawn without an editor.
 *
 * This is the face a reader sees before they click in, and it used to draw an
 * uploaded picture as a paperclip and a video as nothing — the bytes were only
 * reachable once the Tiptap node view mounted. So the same bytes are drawn here,
 * lazy and with the size the node already recorded, because the alternative is a
 * card that changes shape when it gains focus.
 *
 * An embed draws its poster still rather than an iframe: one iframe per card is
 * the cost that made this path worth special-casing, and a reader who means to
 * play it is a click away from the panel.
 */
function renderMedia(block: LoroMap, key: string, nodeName: string): ReactNode {
  const kind = staticMediaKind(block, nodeName);
  const width = sized(getAttr(block, "width"));
  const height = sized(getAttr(block, "height"));
  const name = String(getAttr(block, "name") ?? getAttr(block, "alt") ?? "");

  if (kind === "youtube") {
    const videoId = String(getAttr(block, "videoId") ?? "");
    if (!/^[a-zA-Z0-9_-]{11}$/u.test(videoId)) return null;
    return (
      <img
        key={key}
        src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
        alt={String(getAttr(block, "title") ?? "YouTube video")}
        loading="lazy"
        decoding="async"
        data-media-embed="youtube"
        className="my-1 aspect-video w-full rounded object-cover"
      />
    );
  }

  const src = mediaSource(block);
  if (src === null) {
    // Nothing to point at — say what it was rather than leave a blank line.
    return (
      <div
        key={key}
        data-media-missing={kind}
        className="attachment-chip my-1 inline-flex items-center gap-1 rounded border border-[var(--hairline,#e2e8f0)] bg-black/5 dark:bg-white/5 px-2 py-0.5 text-xs text-[var(--ink-muted)]"
      >
        <span aria-hidden="true">{kind === "video" ? "\u{1f3ac}" : "\u{1f5bc}"}</span>
        <span className="truncate max-w-[200px]">
          {name || (kind === "video" ? "Video" : "Media")}
        </span>
      </div>
    );
  }

  if (kind === "video") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: the bytes are the reader's own upload
      <video
        key={key}
        src={src}
        controls
        preload="metadata"
        style={reservedBox(width, height)}
        className="card-media-video w-full"
      />
    );
  }

  return (
    <img
      key={key}
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      className="card-media-image"
      {...(width === null ? {} : { width })}
      {...(height === null ? {} : { height })}
    />
  );
}

function renderBlock(block: unknown, key: string): ReactNode {
  if (isText(block)) {
    return <p key={key}>{renderDelta(block, key)}</p>;
  }
  if (typeof block === "string") {
    return <p key={key}>{block}</p>;
  }
  if (!isMap(block)) return null;

  const nodeName = block.get("nodeName");
  const children = getChildren(block);

  if (nodeName === "paragraph") {
    if (children.length === 0) {
      return (
        <p key={key}>
          <br />
        </p>
      );
    }
    const rendered = children.map((child, idx) => renderInlineChild(child, `${key}-${idx}`));
    const isEmpty = rendered.every((c) => {
      if (c === null || c === undefined || c === "") return true;
      if (Array.isArray(c) && c.length === 0) return true;
      return false;
    });
    return <p key={key}>{isEmpty ? <br /> : rendered}</p>;
  }

  if (nodeName === "heading") {
    const rawLevel = getAttr(block, "level");
    const level = typeof rawLevel === "number" ? Math.min(Math.max(rawLevel, 1), 6) : 1;
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    if (children.length === 0) {
      return (
        <Tag key={key}>
          <br />
        </Tag>
      );
    }
    const rendered = children.map((child, idx) => renderInlineChild(child, `${key}-${idx}`));
    const isEmpty = rendered.every((c) => {
      if (c === null || c === undefined || c === "") return true;
      if (Array.isArray(c) && c.length === 0) return true;
      return false;
    });
    return <Tag key={key}>{isEmpty ? <br /> : rendered}</Tag>;
  }

  if (nodeName === "bulletList") {
    return <ul key={key}>{children.map((child, idx) => renderBlock(child, `${key}-${idx}`))}</ul>;
  }

  if (nodeName === "orderedList") {
    return <ol key={key}>{children.map((child, idx) => renderBlock(child, `${key}-${idx}`))}</ol>;
  }

  if (nodeName === "listItem") {
    return <li key={key}>{children.map((child, idx) => renderBlock(child, `${key}-${idx}`))}</li>;
  }

  if (nodeName === "blockquote") {
    return (
      <blockquote key={key}>
        {children.map((child, idx) => renderBlock(child, `${key}-${idx}`))}
      </blockquote>
    );
  }

  if (nodeName === "codeBlock") {
    return (
      <pre key={key}>
        <code>{children.map((child, idx) => renderInlineChild(child, `${key}-${idx}`))}</code>
      </pre>
    );
  }

  if (nodeName === "horizontalRule") {
    return <hr key={key} />;
  }

  if (nodeName === "propertyBlock" || nodeName === "property_block") {
    const fieldId = String(getAttr(block, "fieldId") ?? "");
    return (
      <div
        key={key}
        className="property-block-chip my-1 rounded px-2 py-0.5 text-xs bg-black/5 dark:bg-white/5 text-[var(--ink-muted)]"
      >
        [{fieldId}]
      </div>
    );
  }

  if (
    nodeName === "media" ||
    nodeName === "attachment" ||
    nodeName === "image" ||
    nodeName === "video" ||
    nodeName === "youtube"
  ) {
    return renderMedia(block, key, nodeName);
  }

  if (nodeName === "tourStep") {
    const label = String(getAttr(block, "label") ?? getAttr(block, "title") ?? "Step");
    return (
      <div
        key={key}
        className="tour-step-chip my-1 rounded border border-[var(--accent,#4338ca)]/20 bg-[var(--accent-tint,#e0e7ff)] px-2 py-0.5 text-xs font-medium text-[var(--accent,#4338ca)]"
      >
        📍 {label}
      </div>
    );
  }

  if (children.length > 0) {
    return <div key={key}>{children.map((child, idx) => renderBlock(child, `${key}-${idx}`))}</div>;
  }

  return null;
}

/**
 * Whether opening this body for editing will add a trailing paragraph.
 *
 * Measured against the editor, not guessed: a body ending on anything other than a
 * paragraph gains exactly one empty paragraph on mount — checked for a heading, a list,
 * a blockquote, a media block and a divider, all of which went from two children to
 * three. Only a paragraph ending gains nothing.
 */
function needsCaretSlot(last: unknown): boolean {
  if (!isMap(last)) return false;
  return last.get("nodeName") !== "paragraph";
}

function isBodyEmpty(container: LoroMap | null): boolean {
  if (!container) return true;
  const children = getChildren(container);
  if (children.length === 0) return true;
  if (children.length === 1) {
    const first = children[0];
    if (isMap(first) && first.get("nodeName") === "paragraph") {
      const grandChildren = getChildren(first);
      if (grandChildren.length === 0) return true;
      if (grandChildren.length === 1 && isText(grandChildren[0])) {
        return grandChildren[0].toString().trim().length === 0;
      }
    }
  }
  return false;
}

function isTitleEmpty(container: LoroMap | null): boolean {
  if (!container) return true;
  const children = getChildren(container);
  if (children.length === 0) {
    const text = container.get("text");
    if (isText(text)) return text.toString().trim().length === 0;
    return true;
  }
  for (const child of children) {
    if (isText(child) && child.toString().trim().length > 0) return false;
    if (isMap(child)) {
      if (child.get("nodeName") === "mention") return false;
      const grandChildren = getChildren(child);
      if (grandChildren.length === 0 && child.get("nodeName") !== "paragraph") return false;
      for (const gc of grandChildren) {
        if (isText(gc) && gc.toString().trim().length > 0) return false;
        if (isMap(gc)) return false;
      }
    }
  }
  return true;
}

function renderTitle(container: LoroMap): ReactNode {
  const children = getChildren(container);
  if (children.length === 0) {
    const text = container.get("text");
    if (isText(text)) return renderDelta(text, "title-direct");
    return null;
  }
  return children.map((child, idx) => {
    if (isMap(child)) {
      const grandChildren = getChildren(child);
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: title paragraph blocks are position-ordered text segments without stable identity.
        <Fragment key={`title-p-${idx}`}>
          {grandChildren.map((gc, gcIdx) => renderInlineChild(gc, `title-${idx}-${gcIdx}`))}
        </Fragment>
      );
    }
    return renderInlineChild(child, `title-${idx}`);
  });
}

function useLoroContainer(
  doc: LoroDoc,
  containerId: ContainerID | null | undefined,
): LoroMap | null {
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!containerId) return;
    const container = doc.getContainerById(containerId);
    if (!container) return;

    let cancelTimer: (() => void) | null = null;
    const onUpdate = () => {
      if (cancelTimer !== null) return;
      if (typeof requestAnimationFrame === "function") {
        const handle = requestAnimationFrame(() => {
          cancelTimer = null;
          setVersion((v) => v + 1);
        });
        cancelTimer = () => cancelAnimationFrame(handle);
      } else {
        const handle = setTimeout(() => {
          cancelTimer = null;
          setVersion((v) => v + 1);
        }, 16);
        cancelTimer = () => clearTimeout(handle);
      }
    };

    const unsubscribe = container.subscribe(onUpdate);
    return () => {
      unsubscribe();
      if (cancelTimer !== null) cancelTimer();
    };
  }, [doc, containerId]);

  if (!containerId) return null;
  const container = doc.getContainerById(containerId);
  return isMap(container) ? container : null;
}

export interface StaticCardTitleProps {
  cardDoc: LoroDoc;
  titleId?: ContainerID | null | undefined;
  className?: string | undefined;
}

export function StaticCardTitle({ cardDoc, titleId, className }: StaticCardTitleProps) {
  const container = useLoroContainer(cardDoc, titleId);
  const empty = isTitleEmpty(container);

  return (
    <div className="relative min-w-0">
      <div
        className={`card-title-editor w-full truncate text-[13px] font-semibold leading-5 text-[var(--ink)] focus:outline-none ${className ?? ""}`}
      >
        <p>{empty ? <br /> : renderTitle(container as LoroMap)}</p>
      </div>
      {empty ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 text-[13px] leading-5 text-[var(--ink-muted)]"
        >
          Untitled
        </span>
      ) : null}
    </div>
  );
}

export interface StaticCardBodyProps {
  cardDoc: LoroDoc;
  contentId?: ContainerID | null | undefined;
  canEdit?: boolean | undefined;
  className?: string | undefined;
}

export function StaticCardBody({
  cardDoc,
  contentId,
  canEdit = true,
  className,
}: StaticCardBodyProps) {
  const container = useLoroContainer(cardDoc, contentId);
  const empty = isBodyEmpty(container);

  return (
    <div
      className={`node-card-editor min-h-[52px] w-full px-3 pt-2.5 pb-2 text-sm text-[var(--ink)] focus:outline-none ${className ?? ""}`}
      contentEditable={false}
    >
      {empty ? (
        canEdit ? (
          <p className="is-editor-empty" data-placeholder={BODY_PLACEHOLDER}>
            <br />
          </p>
        ) : null
      ) : (
        <>
          {getChildren(container as LoroMap).map((child, idx) => renderBlock(child, `body-${idx}`))}
          {/* A caret needs somewhere to sit. When a body ends on a block it cannot be
              placed in, the editor appends an empty paragraph the first time it opens,
              and the card grew a line on focus. Drawing the same line here means the
              card is already the size it will be, so focusing it moves nothing. A
              reader who cannot write there never sees it. */}
          {canEdit && needsCaretSlot(getChildren(container as LoroMap).at(-1)) ? (
            <p>
              <br />
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export interface StaticCardFaceProps {
  cardDoc: LoroDoc;
  contentId?: ContainerID | null | undefined;
  canEdit?: boolean | undefined;
  className?: string | undefined;
}

export function StaticCardFace(props: StaticCardFaceProps) {
  return <StaticCardBody {...props} />;
}
