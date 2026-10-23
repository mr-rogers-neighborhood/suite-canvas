# Fractal interfaces: evidence for the ICE canvas

- **Date:** 2026-10-23
- **Scope:** zoomable user interfaces (ZUI), semantic zoom, focus+context, portal navigation,
  level-of-detail transitions, icon legibility and DOM-over-WebGPU budgets.
- **Use:** informs [ADR-0036](./decisions/0036-fractal-lod-and-icon-graph.md) and the LOD
  experiments in [`docs/roadmap/ice-parity.md`](./roadmap/ice-parity.md).
- **Caveat:** the ZUI canon is lab work from 1993–2004 on much smaller displays. There is no
  peer-reviewed field study of Miro/Figma-class infinite canvases, and no literature on a
  WebGPU/DOM hybrid overlay. Claims below are marked **measured**, **design property**, or
  **recommendation**.

## 1. Five ideas worth borrowing

### 1.0 The graph is a scale, not a mode

The product claim should be: **the graph view is what the knowledge base looks like when you zoom
out far enough**, not “a graph mode with a smooth transition.” If the far field uses a different
layout (force-directed, clustered, radial) from the canvas, the transition is a magic trick and
users learn it is “the other view.” One spatial model is the requirement; hysteresis is only a
boundary stabilizer, not the paradigm.

This is why the recommendation below keeps type glyphs at their exact card positions and container
glyphs in their exact frames, and why reference edges are excluded from the far field **even behind
a modifier or filter**. References are never rendered as edges anywhere: an edge is a spatial
drawing, a reference is a row in the outline or a predicate in a filter. The invariant is one
spatial layout; a retrieval layout, if one is ever added, is a separate surface, not a canvas mode.
The moment the far representation needs its own layout, it is no longer the same surface.

### 1.1 Semantic zoom is a content contract, not scaling

Pad++ defined semantic zooming as substituting a *different representation*, not magnifying the same
one: its clock shows hours at normal size, seconds zoomed in, and only the hour zoomed out
([Bederson et al., JVLC 1996](https://doi.org/10.1006/jvlc.1996.0002)). SpaceTree's retrospective
states the rule directly: **“Make it readable or don't bother showing the nodes.”** Its first
prototype scaled nodes continuously; users rejected it because lower levels were “visible but never
readable” ([Plaisant et al., InfoVis 2002](https://drum.lib.umd.edu/bitstreams/4712e278-dc6f-483a-92d3-849acf631914/download)).
Cytoscape encodes the same idea as `min-zoomed-font-size`; MapLibre uses `[minzoom, maxzoom)` per
layer ([Cytoscape](https://js.cytoscape.org/), [MapLibre](https://maplibre.org/maplibre-style-spec/layers/)).

**Recommendation:** keep discrete bands and make each a testable content contract:

| Band | Content contract |
| --- | --- |
| `full` | body text ≥ 11 px effective, mounted editor, full chrome |
| `compact` | title + type glyph + counts; no body text |
| `icon` | type glyph + layout badge; no text at rest |
| `hidden` | nothing; the object is culled |

Treat text smaller than 9 px effective at rest as a rendering bug, not a style choice. A card title
may survive into `compact`; body text never does. At `icon`, keep glyph-only until `compact`; no
ellipsized stub, because “Kn…” implies a title is available. Show a short title on hover, focus or
selection at a readable size. Title presence is banded, not faded; the compact band's existing
threshold is the only threshold.

ZMLT adds two properties Suite must keep: **real** (every level shows real vertices and paths, no
invented aggregates) and **persistent** (a node shown at one level survives at all deeper levels)
([Nachmanson et al., arXiv 2019](https://arxiv.org/abs/1906.05996)). A semantic zoom that
re-clusters the card you were aiming at fails the persistence rule.

### 1.2 Two-phase rendering: coarse while moving, exact at rest

Pad++ held 600,000 objects at roughly 10 fps by not drawing very small objects, drawing larger ones
at reduced resolution, and refining them “when the user stops changing the view”
([Bederson & Hollan, UIST 1994](https://www.cs.umd.edu/hcil/pad++/papers/uist-94-pad/uist-94-pad.pdf)).
Cytoscape exposes the same trade as `textureOnViewport` and `hideEdgesOnViewport`
([Cytoscape](https://js.cytoscape.org/)); React Flow culls with `onlyRenderVisibleElements`
([React Flow](https://reactflow.dev/learn/advanced-use/performance)).

**Recommendation:** separate a **motion frame** from a **settle frame**. Motion frames paint GPU
proxies only: type glyph, cached label atlas, edges only above an edge-population threshold. After
80–120 ms of idle, run one incremental mount pass with a ~6 ms deadline and a cap of ~6 new editors
per frame, centre-out. Surface `mountedEditors`, `proxyCards` and `settleMs` in `?perf=1`.

### 1.3 Portals are live, event-routed views

Pad++'s portal contract is essentially ADR-0030 §3, written in 1996: portals provide views onto
other areas, pass interaction events to the place they look at, can filter input, and can be
“sticky” to stay fixed on screen
([Bederson et al., JVLC 1996](https://doi.org/10.1006/jvlc.1996.0002)).

**Recommendation:** adopt the semantics explicitly:

- an expanded portal routes pointer, wheel and keyboard to the child instance's camera;
- a collapsed portal swallows input except “enter”;
- presentation filtering becomes a **per-band interaction mask**, not ad-hoc checks;
- “sticky” remains available for legends and indexes;
- cycles and depth caps stay, because portals are recursive by construction.

### 1.4 Overview helps orientation, not always speed

Hornbæk et al. (32 participants, two maps) found no accuracy difference between a ZUI with and
without an overview, but 80% preferred the overview and said it helped them keep track of position.
On one multi-level map, participants were **faster without it**, attributed to semantic zoom
supplying richer cues; switching between overview and detail windows cost time
([Hornbæk et al., ToCHI 2002](https://doi.org/10.1145/586081.586086)). Halo's edge arcs for
off-screen locations cut task time 16–33% versus arrows
([Baudisch & Rosenholtz, CHI 2003](https://www.patrickbaudisch.com/publications/2003-Baudisch-CHI03-Halo.pdf)).
Halo is about off-screen *locations*, not whole-canvas minimaps; do not generalise the number.

**Recommendation:** put the overview in the same plane, not a second window. A GPU-drawn minimap
with band colouring, portal outlines, viewport rectangle and presence dots is a reasonable
synthesis, but its accuracy benefit is **not** established. Treat it as orientation scaffolding and
make it passive (click-to-jump) until an experiment says otherwise. Use edge arcs for off-screen
portals, not for every card.

### 1.5 A camera grammar: short transitions, checkpoints, re-findable places

SpaceTree's most positive feedback came from a decomposed “trim, translate, grow” animation, not a
continuous fly-through
([Plaisant et al., InfoVis 2002](https://drum.lib.umd.edu/bitstreams/4712e278-dc6f-483a-92d3-849acf631914/download)).
Two independent studies found animated view transitions reduce errors and are preferred; **short
transitions were as effective as long ones**
([Shanmugasundaram et al., GI 2007](https://doi.org/10.1145/1268517.1268531);
[Shanmugasundaram & Irani, AVI 2008](https://doi.org/10.1145/1385569.1385642)).
Space-scale diagrams explain why a naive linear pan/zoom interpolation makes the world “move away as
the zoom dominates”; a monotonic joint path needs **log-scale interpolation**
([Furnas & Bederson, CHI 1995](https://doi.org/10.1145/223904.223934)).

**Recommendation:** portal entry is a three-beat transition of roughly 180–250 ms: trim (dim
siblings outside the target subtree), translate (camera to the child frame), grow (expand one band).
Never interpolate across more than ~2× scale in one move. Keep a camera history with named
checkpoints; make the breadcrumb the instance path; ship “back to previous view” as a first-class
control. Persisted named Views are cheap and turn re-finding into a shared object.

## 2. Five things not to borrow

1. **Free click-anywhere zoom.** SpaceTree's first browser let users zoom by clicking anywhere; it
   was “only usable by expert zooming users, others being rapidly lost in the fog of empty
   information space”
   ([Plaisant et al.](https://drum.lib.umd.edu/bitstreams/4712e278-dc6f-483a-92d3-849acf631914/download)).
   Zoom targets are objects: card, portal, section. Empty-space drag pans.
2. **Continuous geometric scaling of content.** At 0.4×, 14 px body text is 5.6 px: present,
   expensive and unreadable. Scaling text is not semantic zoom.
3. **A detached, independently driven overview window.** The switching cost is measurable; an
   overview with its own pan and zoom is a second navigation problem.
4. **Render-pipeline LOD thresholds transplanted to UI.** three.js `hysteresis`, glTF `MSFT_lod` and
   Unreal HLOD substitute meshes by distance or screen coverage. In a knowledge canvas the
   substitute changes meaning; thresholds must come from legibility and content type.
5. **Unbounded recursion and an unqualified “infinite”.** A legal document can contain A→B→A.
   Without a cycle stub, depth cap and expansion budget, render cost becomes a function of the
   document rather than the viewport. A stub must be visible and clickable, never a silent
   truncation.

Also avoid moving readable text into the canvas to save DOM: accessibility, selection and Tiptap
parity are why the card layer is DOM. Do not rely on HTML-in-canvas; it is flag-gated and
snapshot-based ([WICG](https://github.com/WICG/html-in-canvas)).

## 3. What the evidence does not support

- **Literal “fractal” layout is not an evidenced interaction model.** Searches across OpenAlex and
  Crossref for fractal or self-similar UI returned unrelated domains. The defensible neighbours are
  scale-as-a-dimension (space-scale diagrams), recursive containment (Pad++ portals), recursive
  subdivision (treemaps) and multi-level trees (ZMLT). Keep “fractal” as an internal metaphor, not
  a justification for a layout algorithm.
- **Hyperbolic/fisheye as the primary canvas is not supported.** H3 laid out 20,000 nodes but
  needed explicit prune/expand; no shipping consumer canvas uses hyperbolic distortion as its main
  model ([Munzner, InfoVis 1997](https://doi.org/10.1109/INFVIS.1997.636718)).
- **Zoom-only comparison is risky.** Plumlee & Ware found task times matched a visual-working-memory
  model but error rates were much higher with zooming than with multiple windows
  ([ToCHI 2006](https://doi.org/10.1145/1165734.1165736)). Focus+context and multiple views still
  matter for comparison tasks.
- **The exact 0.12 / 0.35 / 0.75 thresholds are an untested inference.** They are a starting
  contract; the experiments below should challenge them.
- **No peer-reviewed study exists of a continuous icon-graph ↔ editable-card morph.** The closest
  evidence is discrete LOD, ZMLT and scalable insets. Treat the morph as exploratory.

## 4. Experiments

These can run in the existing `SuiteCardLab` fixture. Each records method, sample, result and
decision in the parity roadmap.

| # | Experiment | Measures | Success |
| --- | --- | --- | --- |
| E1 | **Icon-band identification.** 3 icon recipes (glyph; 2-line title; glyph + title + type dot) × 3 bands (0.18, 0.5, 1.0), 24 cards with confusable pairs. | Accuracy, median time-to-find, confusion matrix. | Icon band ≥ 85% of full-band accuracy; ≤ 1.5× time; no confusable pair > 20% mutual confusion. |
| E2 | **Portal depth and lostness.** Find a named card three portals deep, return, name the board you came from. | Time-to-target, path efficiency, backtrack count, orientation accuracy. | ≥ 80% orientation; median time ≤ 2× flat baseline; ≤ 1 backtrack; path efficiency ≥ 0.7. |
| E3 | **Overlay budget.** 200 visible cards / 40 editors / 6 portals on the reference machine. | Frame-time p95, INP, settle-to-interactive, mounted editors, heap over 10 min. | p95 < 16.7 ms pan; INP < 200 ms; settle < 250 ms; heap growth < 10%. |
| E4 | **Camera flight.** 2×2×2: instant vs 250 ms × linear vs log-scale × into depth-2 portal vs back. | Orientation errors, time-to-first-correct-click, recovery pans. | Animated log-scale cuts orientation errors ≥ 30% vs instant with ≤ +10% time; log beats linear by ≥ 15%. |
| E5 | **Threshold crossing.** Hysteresis 0 / 80 / 160 ms × slow/flick sweep × text/image card. | Band flips, layout shift, object constancy, edit-entry latency, dropped frames. | 0 flips with hysteresis; ≥ 95% constancy; p95 edit-entry < 150 ms; < 2 px shift; ≥ 55 fps. |
| E6 | **Two-phase settle.** Motion frame vs settle mount with 6 ms deadline and 6 editors/frame. | Time to first readable card, settle time, long tasks. | First readable card ≤ 100 ms; settle ≤ 250 ms at 40 editors; no long task > 100 ms. |

## 5. Sources

Primary:

- Bederson & Hollan, *Pad++*, UIST 1994 — https://www.cs.umd.edu/hcil/pad++/papers/uist-94-pad/uist-94-pad.pdf
- Bederson, Hollan, Perlin, Meyer, Bacon & Furnas, *Pad++*, JVLC 1996 — https://doi.org/10.1006/jvlc.1996.0002
- Furnas & Bederson, *Space-Scale Diagrams*, CHI 1995 — https://doi.org/10.1145/223904.223934
- Plaisant, Grosjean & Bederson, *SpaceTree*, InfoVis 2002 — https://drum.lib.umd.edu/bitstreams/4712e278-dc6f-483a-92d3-849acf631914/download
- Hornbæk, Bederson & Frøkjær, *Navigation Patterns and Usability of ZUIs*, ToCHI 2002 — https://doi.org/10.1145/586081.586086
- Baudisch & Rosenholtz, *Halo*, CHI 2003 — https://www.patrickbaudisch.com/publications/2003-Baudisch-CHI03-Halo.pdf
- Nachmanson et al., *ZMLT*, arXiv 2019 — https://arxiv.org/abs/1906.05996
- Shanmugasundaram, Irani & Gutwin, GI 2007 — https://doi.org/10.1145/1268517.1268531
- Shanmugasundaram & Irani, AVI 2008 — https://doi.org/10.1145/1385569.1385642
- Plumlee & Ware, ToCHI 2006 — https://doi.org/10.1145/1165734.1165736
- Munzner, *H3*, InfoVis 1997 — https://doi.org/10.1109/INFVIS.1997.636718
- Gruget, Touya & Muehlenhaus, *FogDetector*, GIScience 2023 — https://doi.org/10.4230/LIPIcs.GIScience.2023.73
- Lin et al., small-icon legibility, 2007 — https://doi.org/10.2466/pms.104.1.191-200
- Lin et al., pictogram/text size, 2021 — https://doi.org/10.1177/00187208211061938

Platform and product:

- MapLibre layers — https://maplibre.org/maplibre-style-spec/layers/
- Cytoscape style reference — https://js.cytoscape.org/
- React Flow performance — https://reactflow.dev/learn/advanced-use/performance
- three.js `LOD` hysteresis — https://github.com/mrdoob/three.js/blob/dev/src/objects/LOD.js
- glTF `MSFT_lod` — https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/MSFT_lod/README.md
- Unreal HLOD — https://dev.epicgames.com/documentation/en-us/unreal-engine/hierarchical-level-of-detail-in-unreal-engine
- tldraw camera/culling — https://tldraw.dev/sdk-features/camera · https://tldraw.dev/sdk-features/culling
- Capacities graph view — https://docs.capacities.io/reference/graph-view
- Heptabase UI logic — https://wiki.heptabase.com/user-interface-logic
- Figma zoom and outlines — https://help.figma.com/hc/en-us/articles/360041065034 · https://help.figma.com/hc/en-us/articles/5724448965527

The full research notes, including the verification ledger and source-by-source caveats, are in the
session artifact used to write this summary.
