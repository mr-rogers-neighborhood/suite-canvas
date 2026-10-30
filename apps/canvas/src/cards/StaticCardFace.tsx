import {
  type ContainerID,
  getType,
  isContainer,
  type LoroDoc,
  LoroList,
  LoroMap,
  LoroText,
} from "loro-crdt";
import { Fragment, type ReactNode, useEffect, useState } from "react";
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

  if (nodeName === "image") {
    const src = String(getAttr(block, "src") ?? "");
    const alt = String(getAttr(block, "alt") ?? "");
    if (!src) return null;
    return (
      <img
        key={key}
        src={src}
        alt={alt}
        className="my-1 max-h-60 rounded object-contain"
        loading="lazy"
      />
    );
  }

  if (nodeName === "attachment") {
    const name = String(getAttr(block, "name") ?? "Attachment");
    return (
      <div
        key={key}
        className="attachment-chip my-1 inline-flex items-center gap-1 rounded border border-[var(--hairline,#e2e8f0)] bg-black/5 dark:bg-white/5 px-2 py-0.5 text-xs text-[var(--ink-muted)]"
      >
        <span>📎</span>
        <span className="truncate max-w-[200px]">{name}</span>
      </div>
    );
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
        getChildren(container as LoroMap).map((child, idx) => renderBlock(child, `body-${idx}`))
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
