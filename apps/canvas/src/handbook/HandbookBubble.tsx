import type { Target } from "@suite/graph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFloatGesture } from "../canvas/floatGesture";
import { planFloats } from "../canvas/floatPlan";
import { useNavigateTarget } from "../canvas/navigateTarget";
import { shellBounds, shellObstacles } from "../canvas/shellObstacles";
import { targetElement } from "../canvas/targetElement";
import { FeedbackComposer } from "../feedback/FeedbackComposer";
import { useFeedbackCapability } from "../feedback/useFeedbackCapability";
import { ExplainPanel } from "../panels/ExplainPanel";
import { useEscapeLayer } from "../shell/escapeLayers";
import { activeHandbookRect, defaultHandbookRects, useHandbookStore } from "../store/handbookStore";
import { usePinStore } from "../store/pinStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { HANDBOOK_ARTICLES } from "./articles.generated";
import { HandbookSpotlight } from "./HandbookSpotlight";
import { articleAnswers, firstPresentTarget, matchArticles } from "./match";
import { HANDBOOK_REGION_ATTRIBUTE, regionLabel } from "./regions";
import { boxOf } from "./spotlightGeometry";
import type { HandbookArticle } from "./types";
import { usePresentTargets } from "./usePresentTargets";
import "../styles/handbook.css";

/** How far a press may travel and still count as a click on the pill rather than a drag. */
const CLICK_SLOP = 4;

/**
 * This panel's own region, in the shape the matcher uses.
 *
 * It is the `handbook-bubble` entry in `regions.ts`, which is also the value of this component's
 * `data-handbook-region`: the panel is the one documented region whose presence it should not
 * count, because it is the thing doing the counting.
 */
const SELF_TARGET_KEY = "ui:handbook-bubble";

/** The targets a selection names, in the order the reader selected them. */
function targetsOfSelection(
  ids: readonly string[],
  cards: readonly { id: string }[],
  sections: readonly { id: string }[],
): Target[] {
  const cardIds = new Set(cards.map((card) => card.id));
  const sectionIds = new Set(sections.map((section) => section.id));
  return ids.flatMap((id): Target[] => {
    if (cardIds.has(id)) return [{ kind: "card", id }];
    if (sectionIds.has(id)) return [{ kind: "section", id }];
    return [];
  });
}

/** The target a clicked element stands for, for the picker. */
function targetOfElement(element: Element): Target | null {
  const region = element.closest(`[${HANDBOOK_REGION_ATTRIBUTE}]`);
  const regionId = region?.getAttribute(HANDBOOK_REGION_ATTRIBUTE);
  if (regionId) return { kind: "ui", id: regionId };
  const node = element.closest("[data-node-id]");
  const nodeId = node?.getAttribute("data-node-id");
  if (nodeId) return { kind: "card", id: nodeId };
  return null;
}

/**
 * The handbook, as a shell float (ADR-0045 amendment).
 *
 * Collapsed it is a pill with the count of what on screen is documented. Open, it is a panel:
 * the articles that match this screen, or one article, or the feedback form. Both sizes are
 * floats: a press on the pill drags it, a corner drags the panel, and `planFloats` keeps either
 * clear of the chrome, the pins and the thing an open article is pointing at.
 *
 * It is mounted once, in the shell, because it is chrome rather than canvas: nothing about it is
 * document data, and it must survive a board switch the way the title bar does.
 */
export function HandbookBubble() {
  const open = useHandbookStore((state) => state.open);
  const collapsed = useHandbookStore((state) => state.collapsed);
  const expanded = useHandbookStore((state) => state.expanded);
  const articleId = useHandbookStore((state) => state.articleId);
  const lastArticleId = useHandbookStore((state) => state.lastArticleId);
  const scope = useHandbookStore((state) => state.scope);
  const pane = useHandbookStore((state) => state.pane);
  const picking = useHandbookStore((state) => state.picking);
  const toggle = useHandbookStore((state) => state.toggle);
  const setOpen = useHandbookStore((state) => state.setOpen);
  const setRect = useHandbookStore((state) => state.setRect);
  const openArticle = useHandbookStore((state) => state.openArticle);
  const closeArticle = useHandbookStore((state) => state.closeArticle);
  const setPane = useHandbookStore((state) => state.setPane);
  const setPicking = useHandbookStore((state) => state.setPicking);
  const addToScope = useHandbookStore((state) => state.addToScope);
  const removeFromScope = useHandbookStore((state) => state.removeFromScope);
  const setScope = useHandbookStore((state) => state.setScope);
  const clearScope = useHandbookStore((state) => state.clearScope);

  const purpose = useUiStore((state) => state.purpose);
  const selectedIds = useUiStore((state) => state.selectedNodeIds);
  const snapshot = useWorkspaceSnapshot();
  const pinned = usePinStore((state) => state.pinned);
  const rects = usePinStore((state) => state.rects);
  const navigateTo = useNavigateTarget();
  const capability = useFeedbackCapability();
  const { present } = usePresentTargets();

  const [hover, setHover] = useState<{ target: Target; anchor: ReturnType<typeof boxOf> } | null>(
    null,
  );
  const frame = useRef<HTMLDivElement | null>(null);
  const press = useRef<{ x: number; y: number; dragged: boolean } | null>(null);

  const rect = activeHandbookRect({ open, collapsed, expanded });
  /**
   * What the badge counts, with the handbook itself taken out.
   *
   * The panel is on screen and it does have an article, so counting it would be true and useless:
   * the badge would never read zero, and "nothing here is documented yet" would be unreachable. The
   * article about the handbook is still shipped, still in the docs and still reachable when explain
   * mode scopes it; it just does not pad its own list.
   */
  const matchable = useMemo(() => {
    const withoutSelf = new Set(present);
    withoutSelf.delete(SELF_TARGET_KEY);
    return withoutSelf;
  }, [present]);

  const match = useMemo(
    () => matchArticles(HANDBOOK_ARTICLES, matchable, scope),
    [matchable, scope],
  );
  const article =
    articleId === null ? null : (HANDBOOK_ARTICLES.find((entry) => entry.id === articleId) ?? null);

  // A first visit has no stored rect: park the pill bottom-right, over the canvas, clear of the
  // dock and the window edge.
  useEffect(() => {
    if (collapsed.x !== 0 || collapsed.y !== 0) return;
    const defaulted = defaultHandbookRects({
      width: window.innerWidth,
      height: window.innerHeight,
    });
    setRect("collapsed", defaulted.collapsed);
    setRect("expanded", defaulted.expanded);
  }, [collapsed.x, collapsed.y, setRect]);

  /**
   * Keep the surface clear of the chrome and the pins.
   *
   * The thing an article points at is deliberately not an obstacle. It was one for a while, and
   * the effect was comic: hovering a row shoved the panel sideways, and the row about the handbook
   * itself made the handbook dodge its own outline. A panel that moves while the pointer is inside
   * it also moves the row out from under that pointer, which starts the whole thing again.
   */
  const settle = useCallback(() => {
    const state = useHandbookStore.getState();
    const current = activeHandbookRect(state);
    const obstacles = [
      ...shellObstacles(frame.current),
      ...pinned.flatMap((cardId, index) => {
        const pin = rects[cardId];
        return pin === undefined ? [] : [{ id: `pin-${String(index)}`, ...pin }];
      }),
    ];
    const plan = planFloats({
      moving: [{ id: "handbook", ...current }],
      obstacles,
      bounds: shellBounds(),
    });
    const planned = plan.rects[0];
    if (!planned) return;
    if (
      planned.x === current.x &&
      planned.y === current.y &&
      planned.width === current.width &&
      planned.height === current.height
    ) {
      return;
    }
    setRect(state.open ? "expanded" : "collapsed", {
      x: planned.x,
      y: planned.y,
      width: planned.width,
      height: planned.height,
    });
  }, [pinned, rects, setRect]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a settle is requested by the size, the obstacles and the window, not by the callback's identity.
  useEffect(() => {
    settle();
    window.addEventListener("resize", settle);
    return () => window.removeEventListener("resize", settle);
  }, [open, settledKey(pinned, rects)]);

  // Explain mode is the inverse of the handbook: a selection becomes a question, so the panel
  // opens on the articles that answer it and a single thing jumps straight to its article.
  useEffect(() => {
    if (purpose !== "explain") {
      clearScope();
      return;
    }
    const targets = targetsOfSelection(selectedIds, snapshot.cards, snapshot.sections);
    setScope(targets);
    setPicking(false);
    if (targets.length === 0) return;
    setOpen(true);
    setPane("handbook");
    if (targets.length === 1) {
      const only = targets[0] as Target;
      const answer = HANDBOOK_ARTICLES.find((entry) => articleAnswers(entry, only));
      if (answer) openArticle(answer.id);
    } else {
      closeArticle();
    }
  }, [
    purpose,
    selectedIds,
    snapshot.cards,
    snapshot.sections,
    clearScope,
    setScope,
    setOpen,
    setPane,
    openArticle,
    closeArticle,
    setPicking,
  ]);

  useEscapeLayer(() => {
    if (picking) {
      setPicking(false);
      return;
    }
    if (open) setOpen(false);
  }, open || picking);

  // The picker. Capture on pointerdown, so the canvas never also treats the press as a
  // selection, a pan or a drag: while this is armed the next click is a question, not an edit.
  useEffect(() => {
    if (!picking) return;
    const onPointerDown = (event: PointerEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const target = element === null ? null : targetOfElement(element);
      event.preventDefault();
      event.stopPropagation();
      if (target) addToScope(target);
      setPicking(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [picking, addToScope, setPicking]);

  const gesture = useFloatGesture({
    onMove: (_id, next) => setRect(open ? "expanded" : "collapsed", next),
    onEnd: settle,
  });

  /**
   * A press on the pill opens it or drags it; the distance decides, and the click decides too.
   *
   * The gesture starts only once the pointer has travelled, so a press that turns out to be a
   * click never nudges the pill. The click handler is what makes the button keyboard-operable:
   * a control whose only listener is a pointer event has no Enter key.
   */
  const startPill = (event: React.PointerEvent) => {
    press.current = { x: event.clientX, y: event.clientY, dragged: false };
  };
  const movePill = (event: React.PointerEvent) => {
    const start = press.current;
    if (!start || start.dragged) return;
    if (
      Math.abs(event.clientX - start.x) <= CLICK_SLOP &&
      Math.abs(event.clientY - start.y) <= CLICK_SLOP
    ) {
      return;
    }
    start.dragged = true;
    gesture.start({ clientX: start.x, clientY: start.y }, { id: "handbook", rect, mode: "move" });
  };
  const clickPill = () => {
    const start = press.current;
    press.current = null;
    if (start?.dragged === true) return;
    toggle();
  };

  const showRow = (entry: HandbookArticle, element: HTMLElement) => {
    const target = firstPresentTarget(entry, present);
    setHover(target === null ? null : { target, anchor: boxOf(element.getBoundingClientRect()) });
  };

  const showArticleTarget = () => {
    if (article === null) return;
    const target = firstPresentTarget(article, present);
    if (target === null) return;
    const element = targetElement(target);
    if (element) {
      setHover({ target, anchor: boxOf(frame.current?.getBoundingClientRect() ?? new DOMRect()) });
      return;
    }
    // Not on this screen: opening it is the one step allowed to move the view.
    navigateTo(target);
  };

  const body = useRef<HTMLDivElement | null>(null);

  /**
   * A link inside an article is a `target:` URL, which is how one article points at the thing
   * another article documents. The listeners go on the anchors rather than on the body as a
   * whole: a clickable container of prose has no role that makes a screen reader's "click" mean
   * anything, while a link that opens another article is just a link.
   */
  useEffect(() => {
    const root = body.current;
    if (!root || article === null) return;
    const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href^="target:"]')];
    const handlers = anchors.map((anchor) => {
      const listener = (event: MouseEvent) => {
        event.preventDefault();
        const [, kind, ...rest] = (anchor.getAttribute("href") ?? "")
          .slice("target:".length)
          .split(":");
        const id = rest.join(":");
        if (!kind || !id) return;
        const target = { kind, id } as Target;
        const answer = HANDBOOK_ARTICLES.find((entry) => articleAnswers(entry, target));
        if (answer) {
          openArticle(answer.id);
          return;
        }
        navigateTo(target);
      };
      anchor.addEventListener("click", listener);
      return () => anchor.removeEventListener("click", listener);
    });
    return () => {
      for (const off of handlers) off();
    };
  }, [article, openArticle, navigateTo]);

  const regionTargets = useMemo(() => scope.filter((target) => target.kind === "ui"), [scope]);

  return (
    <>
      <HandbookSpotlight target={hover?.target ?? null} anchor={hover?.anchor ?? null} />

      <div
        ref={frame}
        data-testid="handbook-bubble"
        data-handbook-region="handbook-bubble"
        data-open={open ? "true" : undefined}
        className="handbook-bubble pointer-events-auto fixed z-[46]"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        {open ? (
          <>
            <header className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-2.5 py-1.5">
              <span aria-hidden="true" className="text-[12px] text-[var(--accent)]">
                {"\u25c8"}
              </span>
              <span className="text-[12px] font-medium">Handbook</span>
              <span className="text-[11px] text-[var(--ink-muted)]" data-testid="handbook-summary">
                {match.items} {match.items === 1 ? "item" : "items"} · {match.articles.length}{" "}
                {match.articles.length === 1 ? "article" : "articles"}
              </span>
              <button
                type="button"
                aria-label="Close the handbook"
                data-testid="handbook-close"
                className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setOpen(false)}
              >
                {"\u00d7"}
              </button>
            </header>

            {purpose === "explain" ? (
              <div className="shrink-0 px-2.5 pt-1.5">
                <ExplainPanel variant="embedded" />
                {scope.length > 0 ? (
                  <div
                    className="flex flex-wrap items-center gap-1 pb-1.5"
                    data-testid="handbook-scope"
                  >
                    <span className="text-[11px] text-[var(--ink-muted)]">
                      Explain · {scope.length} {scope.length === 1 ? "thing" : "things"}
                    </span>
                    {regionTargets.map((target) => (
                      <button
                        key={`${target.kind}:${target.id}`}
                        type="button"
                        className="rounded-full bg-[var(--segmented-bg)] px-1.5 text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                        onClick={() => removeFromScope(target)}
                        title={`Stop explaining ${regionLabel(target.id)}`}
                      >
                        {regionLabel(target.id)} ×
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
              {pane === "feedback" ? (
                <FeedbackComposer
                  surface={article === null ? "handbook" : `handbook:${article.id}`}
                  context={article === null ? undefined : article.title}
                  captcha={capability.captcha}
                  placeholder={
                    article === null
                      ? "What should the handbook say that it does not?"
                      : "What is wrong or missing here?"
                  }
                  onSent={() => setPane("handbook")}
                  onCancel={() => setPane("handbook")}
                />
              ) : article === null ? (
                match.articles.length === 0 ? (
                  <p className="text-[12px] text-[var(--ink-muted)]" data-testid="handbook-empty">
                    {scope.length > 0
                      ? "No article covers what you selected yet. Explain something else, or tell us what is missing."
                      : "Nothing on this screen has an article yet. The handbook grows as the interface does."}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-0.5" data-testid="handbook-list">
                    {match.articles.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="handbook-row"
                          data-testid="handbook-row"
                          data-article-id={entry.id}
                          onClick={() => openArticle(entry.id)}
                          onPointerEnter={(event) => showRow(entry, event.currentTarget)}
                          onPointerLeave={() => setHover(null)}
                          onFocus={(event) => showRow(entry, event.currentTarget)}
                          onBlur={() => setHover(null)}
                        >
                          <span className="truncate text-[12px]">{entry.title}</span>
                          <span className="truncate text-[11px] text-[var(--ink-muted)]">
                            {entry.description}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <article data-testid="handbook-article" data-article-id={article.id}>
                  <div className="mb-1.5 flex items-center gap-1">
                    <button
                      type="button"
                      data-testid="handbook-back"
                      className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => {
                        closeArticle();
                        setHover(null);
                      }}
                    >
                      {"\u2039"} All articles
                    </button>
                  </div>
                  <h2 className="text-[13px] font-semibold">{article.title}</h2>
                  <p className="mb-2 text-[11px] text-[var(--ink-muted)]">{article.description}</p>
                  {/* The body is this repository's own Markdown, rendered at build time. */}
                  <div
                    className="handbook-article"
                    data-testid="handbook-body"
                    onPointerEnter={() => {
                      const target = firstPresentTarget(article, present);
                      const element = frame.current;
                      setHover(
                        target === null || element === null
                          ? null
                          : { target, anchor: boxOf(element.getBoundingClientRect()) },
                      );
                    }}
                    onPointerLeave={() => setHover(null)}
                    ref={body}
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: the HTML is generated from handbook/*.md in this repository at build time, not from user input.
                    dangerouslySetInnerHTML={{ __html: article.html }}
                  />
                </article>
              )}
            </div>

            <footer className="flex shrink-0 items-center gap-1 border-t border-[var(--hairline)] px-2 py-1.5">
              {article === null || article.targets.length === 0 ? null : (
                <button
                  type="button"
                  data-testid="handbook-point"
                  className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                  onClick={showArticleTarget}
                >
                  Show me
                </button>
              )}
              {purpose === "explain" || picking ? (
                <button
                  type="button"
                  data-testid="handbook-pick"
                  aria-pressed={picking}
                  className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                  onClick={() => setPicking(!picking)}
                >
                  {picking ? "Click something…" : "Point at something"}
                </button>
              ) : null}
              <button
                type="button"
                data-testid="handbook-feedback"
                className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                onClick={() => setPane(pane === "feedback" ? "handbook" : "feedback")}
              >
                Send feedback
              </button>
            </footer>
            <button
              type="button"
              className="handbook-grip"
              data-testid="handbook-grip"
              aria-label="Resize the handbook"
              onPointerDown={(event) =>
                gesture.start(event, { id: "handbook", rect, mode: "resize" })
              }
            />
          </>
        ) : (
          <button
            type="button"
            data-testid="handbook-pill"
            title="The handbook"
            className="flex h-full w-full items-center gap-1.5 px-2.5 text-left text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            onPointerDown={startPill}
            onPointerMove={movePill}
            onClick={clickPill}
            onPointerCancel={() => {
              press.current = null;
            }}
          >
            <span aria-hidden="true" className="text-[var(--accent)]">
              {"\u25c8"}
            </span>
            {/* The visible label is the name, so a screen reader hears the same words a
                sighted reader sees. The prefix is what makes the button's verb explicit. */}
            <span className="sr-only">Open the </span>
            <span className="min-w-0 flex-1 truncate">
              {lastArticleId === null
                ? "Handbook"
                : (HANDBOOK_ARTICLES.find((entry) => entry.id === lastArticleId)?.title ??
                  "Handbook")}
            </span>
            {match.items > 0 ? (
              <span className="handbook-bubble__count" data-testid="handbook-count">
                {match.items}
              </span>
            ) : null}
          </button>
        )}
      </div>
    </>
  );
}

/** The store only re-reads a solver request when the pin arrangement actually changes. */
function settledKey(
  pinned: readonly string[],
  rects: Readonly<Record<string, { x: number; y: number }>>,
): string {
  return pinned
    .map((id) => `${id}@${String(rects[id]?.x ?? 0)},${String(rects[id]?.y ?? 0)}`)
    .join("|");
}
