# Refactor: PR-readiness pass on commit 32a3db27 (atlas row + tree pulse + breadcrumb)

## Context (carry forward)
RedLens is a Vite + React 19 atlas viewer. The integration branch just received commit **32a3db27** ("Atlas row redesign + sidebar pulse + breadcrumb refinement"). The behaviour is correct and the visual diff is approved — this pass is purely **idiomatic polish so the diff is comfortable for human reviewers**. The codebase conventions (read `CLAUDE.md` + `src/index.css` first):
- CSS custom properties for every colour and duration; no hardcoded hex.
- Each component has a kebab-case CSS class in `src/index.css` (e.g. `.scope-pill`, `.scope-chip`, `.nav-link`, `.actor-list-item`, `.hint-row`, `.related-node`, `.breadcrumb-link`); inline `style={...}` is reserved for per-instance dynamic values, expressed as CSS custom properties (see `.breadcrumb-link` + `--crumb-color`).
- Variant state via `data-*` attributes (`data-active`, `data-scope`, etc.), chained in CSS.
- Hooks in `src/hooks/`, helpers in `src/lib/`, tests colocated. `pnpm tsc --noEmit` must stay clean.

The repo is also configured to commit as `darkstar-covenant`. **MUST NOT** add `Co-Authored-By: Claude …` trailers to any commit you create.

## Scope

**Allowed to edit:**
- `src/index.css`
- `src/components/atlas/CollapsibleNode.tsx`
- `src/components/atlas/AtlasView.tsx`
- `src/components/atlas/useDepth6Expand.ts` (timer-leak + shadow fix only — commit 7)
- `src/components/tree/TreeSidebar.tsx`
- `src/components/tree/TreeRow.tsx` (only the new pulse-guard simplification in commit 2)
- `src/lib/atlasHelpers.ts`
- New: `src/hooks/usePulseOnChange.ts`
- New: `src/hooks/useCopyState.ts`
- New: `src/lib/atlasHelpers.test.ts`
- New: `src/hooks/usePulseOnChange.test.ts`
- New: `src/hooks/useCopyState.test.ts`
- New: `src/components/atlas/CollapsibleNode.test.tsx`

**MUST NOT edit:** `src/admin/palette-tokens.ts`, anything under `scripts/`, `vendor/`, `public/` data artifacts, `package.json`, `vite.config.ts`, `vitest.config.ts`, the build pipeline, or any atlas data. MUST NOT split `CollapsibleNode.tsx` or `AtlasView.tsx` into multiple component files — those are out-of-scope tech debt for a separate PR.

**MUST NOT** add new dependencies, new abstractions, or scope creep. Only make changes directly requested. Match existing patterns — read neighbouring code before writing.

## Nine commits — work in this order

### Commit 1 — Tokenize `#1f1f1f` and the pulse-flash color (issues A + B)

`src/index.css` currently hardcodes `#1f1f1f` in three rules (`.atlas-node.is-selected`, `.atlas-node.is-selected:hover, .atlas-node.is-selected:focus-visible`, `.atlas-node-meta` selected background) and `rgba(255, 255, 255, 0.28)` in `@keyframes tree-row-pulse`.

- The file currently has TWO `:root` blocks — the **first** (around line 3) holds the main palette; the **second** (around line 135) holds the depth palette only. The split was introduced by the depth-palette migration in this commit. Merge them: move the depth-palette declarations into the first `:root` block (anywhere coherent — a `/* ─── Depth palette ─── */` section comment is fine), then delete the second `:root` block entirely.
- In the merged single `:root` block, add `--atlas-row-selected: #1f1f1f;` and `--row-pulse-flash: rgba(255, 255, 255, 0.28);` next to `--row-focused`.
- Replace every literal use of `#1f1f1f` and `rgba(255, 255, 255, 0.28)` in `src/index.css` with the variable.

Commit subject: `Tokenize atlas-row-selected/pulse-flash + merge :root blocks`.

### Commit 2 — Consolidate the pulse + de-duplicate the hover/selected CSS dance (issues C + D + F)

**Single source of truth for the 700 ms pulse duration.** Currently `TreeSidebar.tsx` has a hardcoded `setTimeout(..., 700)` and `src/index.css` has `animation: tree-row-pulse 700ms ease-out`. They MUST stay in sync.

- Add `--row-pulse-ms: 700ms;` in the same `:root` palette block.
- Use it in the keyframe rule: `animation: tree-row-pulse var(--row-pulse-ms) ease-out;`
- In the new hook (next bullet) read it via:
  ```ts
  const ROW_PULSE_MS = (() => {
    if (typeof window === "undefined") return 700;
    const v = getComputedStyle(document.documentElement).getPropertyValue("--row-pulse-ms").trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 700;
  })();
  ```
  Defined once at module top of `usePulseOnChange.ts`. Fallback is the literal `700` with a `// keep in sync with --row-pulse-ms` comment next to it.

**Extract the pulse pattern into a hook.** Create `src/hooks/usePulseOnChange.ts`:

```ts
import { useEffect, useState } from "react";

export function usePulseOnChange<T extends string | number | null | undefined>(
  value: T,
  ms: number,
): T | null {
  const [pulse, setPulse] = useState<T | null>(null);
  useEffect(() => {
    if (value === null || value === undefined) return;
    setPulse(value);
    const t = setTimeout(() => setPulse(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return pulse;
}
```

Re-export `ROW_PULSE_MS` from `src/hooks/usePulseOnChange.ts` (a named export alongside the hook) so there is exactly one definition. In `src/components/tree/TreeSidebar.tsx` delete the inline `pulseId` `useState` + `useEffect` block and replace with:
```ts
import { usePulseOnChange, ROW_PULSE_MS } from "../../hooks/usePulseOnChange";
// ...
const pulseId = usePulseOnChange(nodeId, ROW_PULSE_MS);
```
Do NOT duplicate the `getComputedStyle` reader anywhere else.

**De-duplicate the selected/hover CSS.** Currently:
```css
.atlas-node.is-selected { background-color: var(--atlas-row-selected); }
.atlas-node:hover, .atlas-node:focus-visible { background-color: var(--hover); outline: none; }
.atlas-node.is-selected:hover, .atlas-node.is-selected:focus-visible { background-color: var(--atlas-row-selected); }
```
Collapse to two rules using `:not(.is-selected)`:
```css
.atlas-node.is-selected { background-color: var(--atlas-row-selected); }
.atlas-node:not(.is-selected):hover,
.atlas-node:not(.is-selected):focus-visible { background-color: var(--hover); outline: none; }
```
The selected meta-bg rule stays one rule, no change needed beyond the variable swap from commit 1.

**Respect `prefers-reduced-motion` on the pulse animation.** The existing `.atlas-node-fresh` rule already does this (`@media (prefers-reduced-motion: reduce) { .atlas-node-fresh { animation: none; } }` at index.css ~line 336). The new `.tree-row.is-pulse` does not. Add a matching rule:
```css
@media (prefers-reduced-motion: reduce) {
  .tree-row.is-pulse {
    animation: none;
  }
}
```
Put it next to the existing `prefers-reduced-motion` block for consistency.

**Tighten the pulse guard in `TreeRow.tsx`.** The current expression `const isPulse = !!pulseId && pulseId === node!.id;` has a redundant truthiness check — `pulseId === null` is already false, so `!!pulseId &&` is dead. Simplify to:
```ts
const isPulse = pulseId === node!.id;
```

Commit subject: `Extract usePulseOnChange hook and drop redundant hover override`.

### Commit 3 — Document `data-row-bar` (issue E)

In `src/components/atlas/CollapsibleNode.tsx`:
- Find the `<div data-row-bar className="flex items-center gap-2">` element (~line 227).
- Add a one-line comment immediately above it:
  `// data-row-bar: marker the outer onClick uses to distinguish title-bar clicks from body clicks (see handler above).`
- At the click-handler check `closest("[data-row-bar]")`, add or extend the existing comment so it reads:
  `// inRowBar = click landed on the title row (chiclets/title), not the expanded body. See data-row-bar attr below.`

Commit subject: `Document data-row-bar marker attribute`.

### Commit 4 — Introduce `buildAncestorsWithSelf` helper (issue G)

In `src/lib/atlasHelpers.ts`:
- Read the existing `buildAncestors` to match its style and JSDoc/comment conventions.
- Add a sibling export:
  ```ts
  export function buildAncestorsWithSelf(
    docs: Record<string, AtlasNode>,
    docNoToId: Map<string, string>,
    nodeId: string,
  ): AtlasNode[] {
    const chain = buildAncestors(docs, docNoToId, nodeId);
    const self = docs[nodeId];
    return self ? [...chain, self] : chain;
  }
  ```

In `src/components/atlas/AtlasView.tsx`:
- Replace the `ancestors` useMemo (~line 155) body so it calls `buildAncestorsWithSelf(...)` directly instead of `buildAncestors(...)` + manual spread.
- Update the import.

In `src/components/atlas/JuniorPane.tsx` (~line 55), do NOT change behaviour. Add a single comment above its `ancestors` useMemo:
`// JuniorPane styles the current node differently from the rest of the chain, so it keeps using buildAncestors and renders the current segment separately. See buildAncestorsWithSelf in atlasHelpers if that ever changes.`

Commit subject: `Introduce buildAncestorsWithSelf for breadcrumb tails`.

### Commit 5 — Movement-threshold drag guard (issue H)

In `src/components/atlas/CollapsibleNode.tsx`:
- Replace the `window.getSelection()?.toString().length > 0` early-return in the click handler with a mousedown-position → click-position movement check.
- Add at the top of the file (with other module constants):
  ```ts
  const DRAG_THRESHOLD_PX = 4;
  ```
- Add a `useRef<{ x: number; y: number } | null>(null)` named `mouseDownRef` inside the component.
- Wire `onMouseDown` on the outer atlas-node div:
  ```ts
  onMouseDown={(e: React.MouseEvent) => {
    mouseDownRef.current = { x: e.clientX, y: e.clientY };
  }}
  ```
- In `onClick`, replace the current selection-length early-return with:
  ```ts
  const down = mouseDownRef.current;
  mouseDownRef.current = null;
  if (down) {
    const dx = Math.abs(e.clientX - down.x);
    const dy = Math.abs(e.clientY - down.y);
    if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) return;
  }
  ```
  Keep the existing `closest('a, button, [role="button"]')` early-return at the top of the handler.

Commit subject: `Use movement threshold instead of getSelection() for drag-vs-click`.

### Commit 6 — Move inline styles in `CollapsibleNode.tsx` into CSS classes

`CollapsibleNode.tsx` contains several multi-line inline `style={}` blocks for purely-static styling — off-pattern vs the rest of the codebase, where each component has its own CSS class with all styling in `src/index.css` and inline `style` is reserved for per-instance dynamic values carried via CSS custom properties (see `.breadcrumb-link` + `--crumb-color` for the precedent).

Make the changes below, then verify the final TSX has **exactly two** inline `style={...}` occurrences: `--c` on each chiclet and `--row-color` on the outer atlas-node div. Everything else MUST be a class.

**6a. `.atlas-type-pill`** — the type badge (currently `<span className="mono" style={{ fontSize: 10, fontWeight: 600, ... }}>{node.type}</span>` around line 86):

Add to `src/index.css` near the other atlas-node rules:
```css
.atlas-type-pill {
  font-family: "Source Code Pro", "Courier New", monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tan-3);
  background: var(--surface);
  border: 1px solid var(--tan-2);
  border-radius: 999px;
  padding: 2px 8px;
  line-height: 1.4;
  white-space: nowrap;
}
.atlas-node.is-selected .atlas-type-pill {
  border-color: var(--tan);
}
```
TSX: `<span className="atlas-type-pill">{node.type}</span>`.

**6b. `.atlas-copy-btn` + `.atlas-copy-flip`** — both copy buttons share the same long className and the same inline-grid "copied" flip (lines ~104–163). Define classes once:
```css
.atlas-copy-btn {
  font-family: "Source Code Pro", "Courier New", monospace;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: 0;
  color: var(--tan-3);
  cursor: pointer;
  transition: color 0.1s;
}
.atlas-copy-btn:hover { color: var(--tan); }
.atlas-copy-btn[data-copied="true"] { color: var(--accent); }

.atlas-copy-flip { display: inline-grid; }
.atlas-copy-flip > * { grid-area: 1 / 1; }
.atlas-copy-flip > .flipped { visibility: hidden; }
.atlas-copy-flip[data-flipped="true"] > .label { visibility: hidden; }
.atlas-copy-flip[data-flipped="true"] > .flipped { visibility: visible; }
```
TSX (apply to BOTH copy buttons):
```tsx
<button
  type="button"
  onClick={handleCopyDocNo}
  title={docNoCopied ? "Copied!" : `Copy ${node.doc_no}`}
  className="atlas-copy-btn"
  data-copied={docNoCopied ? "true" : undefined}
>
  <svg ...>{/* unchanged */}</svg>
  <span className="atlas-copy-flip" data-flipped={docNoCopied ? "true" : undefined}>
    <span className="label">{node.doc_no}</span>
    <span className="flipped">copied</span>
  </span>
</button>
```
Same shape for the UUID button.

**6c. `.atlas-chiclet`** — the depth-coloured squares (lines ~229–242). Pattern matches `.breadcrumb-link` using `--crumb-color`:
```css
.atlas-chiclet {
  display: inline-block;
  box-sizing: content-box;
  width: 11px;
  height: 11px;
  background-color: var(--c, var(--gray));
}
.atlas-chiclet:not(:last-child) {
  border-right: 1px solid var(--bg-deep);
}
```
TSX:
```tsx
{docNoParts.map((_, i) => {
  const c =
    docNoDepths[i] === 0
      ? "var(--gray)"
      : `var(--depth-${Math.min(docNoDepths[i], 17)})`;
  return (
    <span
      key={i}
      className="atlas-chiclet"
      style={{ ["--c" as string]: c } as React.CSSProperties}
    />
  );
})}
```

**6d. `.atlas-node` static styles + `--row-color` custom property for the selected red bar** — current outer `style={...}` (lines ~218–224):

Update `.atlas-node` in `src/index.css`:
```css
.atlas-node {
  padding: 4px 4px 4px 10px;
  border-radius: 4px;
  scroll-margin-top: 64px; /* HEADER_OFFSET in src/lib/layout.ts — keep in sync */
  cursor: pointer;
  transition: background-color 0.1s;
}
.atlas-node.is-selected {
  background-color: var(--atlas-row-selected);
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--row-color) 80%, white);
}
.atlas-node[data-has-hidden="true"] {
  border-bottom: 1px solid var(--border);
}
```
TSX:
```tsx
<div
  id={...}
  className={...}
  data-has-hidden={hiddenCount > 0 ? "true" : undefined}
  style={{ ["--row-color" as string]: color } as React.CSSProperties}
  ...
>
```
Note: `entry.color` is already a `var(--depth-N)` string (see `depthColor` in `src/lib/depth.ts`), so it threads through the CSS-custom-property cleanly. Remove the inline `padding`, `borderRadius`, `boxShadow`, `borderBottom`, and `scrollMarginTop` — they're all in CSS now. Keep `--row-color` as the sole inline carrier. Drop the `HEADER_OFFSET` import from `CollapsibleNode.tsx` only if no other reference remains; leave `src/lib/layout.ts` itself untouched.

**6e. Title colour via CSS inheritance** — drop the inline `style={{ color: isSelected ? "var(--tan)" : "var(--tan-2)" }}` on `<HeadingTag>` (line ~248). Add to `src/index.css`:
```css
.atlas-node-title { color: var(--tan-2); }
.atlas-node.is-selected .atlas-node-title { color: var(--tan); }
```
The heading inherits.

**6f. Fill out `.view-children-affordance`** — the class exists at `src/index.css` lines ~300–309 but only carries hover transitions. Move the 20-line inline `style={}` block (lines ~266–289) into the rule:
```css
.view-children-affordance {
  position: absolute;
  right: 0;
  bottom: 0;
  height: 14px;
  padding: 0 6px;
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
  border-top-left-radius: 4px;
  background: var(--surface);
  color: var(--tan-3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: "Source Code Pro", "Courier New", monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
  line-height: 1;
  transition: background-color 0.1s, color 0.1s;
}
.view-children-affordance:hover,
.view-children-affordance:focus-visible {
  background-color: var(--hover) !important;
  color: var(--tan) !important;
}
```
TSX: drop the `style={...}` block entirely.

**6g. `.atlas-node-body` for the expanded body** — the current inline `style={{ marginLeft: 20 }}` (lines ~304–309) has a stale comment referencing the now-removed toggle. Replace:
```css
.atlas-node-body {
  padding-bottom: 12px;
  margin-top: 8px;
  margin-left: 20px; /* aligns body under the title — chiclet (11) + gap-2 (8) + 1 px slop */
}
```
TSX:
```tsx
{isExpanded && hasContent && (
  <div className="atlas-node-body">
    <NodeContent content={node.content} onNavigate={onNavigate} />
  </div>
)}
```

**6h. Tiny remainders**:
- `<img ... style={{ display: "block" }} />` on the sky-link → replace `style` with the Tailwind `block` class on the existing `className`.
- The font-stack literal `'"Source Code Pro", "Courier New", monospace'` no longer appears inline anywhere after 6a–6f. If you spot another inline `font-family`, replace with the global `.mono` class.

**6i. Final audit**: After all sub-steps, run `grep -n "style={" src/components/atlas/CollapsibleNode.tsx`. The output MUST be exactly two lines — the chiclet `--c` and the outer-node `--row-color`. If any other `style={` remains, you missed one; go back.

Commit subject: `Move CollapsibleNode inline styles into CSS classes`.

### Commit 7 — `useDepth6Expand` timer-leak + variable-shadow fix

`src/components/atlas/useDepth6Expand.ts:17` calls `setTimeout(() => setRecentlyExpanded(...), 350)` but never `clearTimeout`s it. If the hook unmounts during the 350 ms window, the timer still fires `setRecentlyExpanded` on an unmounted instance. React 18 swallows the warning silently but the state update leaks.

Two changes in `useDepth6Expand.ts`:

**7a. Track and clear all pending timers.** Add a `pendingTimers` ref to the hook and:
- In `markRecent`, push the new timer id onto the ref before scheduling.
- In a top-level `useEffect(() => () => { for (const t of pendingTimers.current) clearTimeout(t); }, [])` cleanup, clear every pending timer on unmount.
- In the timer callback, remove its own id from the ref after firing (so the array doesn't grow unbounded over the life of the hook).

Concretely:
```ts
const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

useEffect(() => () => {
  for (const t of pendingTimers.current) clearTimeout(t);
  pendingTimers.current = [];
}, []);

const markRecent = useCallback((ids: string[]) => {
  if (ids.length === 0) return;
  setRecentlyExpanded((prev) => {
    const next = new Set(prev);
    for (const entryId of ids) next.add(entryId);
    return next;
  });
  const t = setTimeout(() => {
    pendingTimers.current = pendingTimers.current.filter((x) => x !== t);
    setRecentlyExpanded((prev) => {
      const next = new Set(prev);
      for (const entryId of ids) next.delete(entryId);
      return next.size === prev.size ? prev : next;
    });
  }, 350);
  pendingTimers.current.push(t);
}, []);
```

**7b. Rename the shadowed loop variable.** The outer hook parameter is `id`; the inner `for (const id of ids)` loop on lines 14 and 20 shadows it. Rename to `entryId` (as shown above) in both spots.

Do NOT touch anything else in `useDepth6Expand.ts` — the rest is out-of-scope behaviour.

Commit subject: `Fix useDepth6Expand timer leak and rename shadowed loop var`.

### Commit 8 — Extract `useCopyState` hook (M6)

`CollapsibleNode.tsx` defines `handleCopyUrl` (~line 67) and `handleCopyDocNo` (~line 76). They are structurally identical: write to clipboard, set a "copied" boolean, reset to false after 1200 ms via `setTimeout` with no cleanup. The 1200 ms magic appears twice. If the row unmounts within 1200 ms of a copy click the timer fires `setX(false)` on an unmounted component.

Extract `src/hooks/useCopyState.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from "react";

const COPY_RESET_MS = 1200;

export function useCopyState(): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, COPY_RESET_MS);
    });
  }, []);

  return { copied, copy };
}
```

In `CollapsibleNode.tsx`:
- Replace the two `useState(false)` + handler blocks with two `useCopyState()` calls:
  ```ts
  const docNoCopy = useCopyState();
  const urlCopy = useCopyState();
  ```
- Replace `handleCopyDocNo` references with an inline `(e) => { e.stopPropagation(); docNoCopy.copy(node.doc_no); }` (or extract local wrappers — agent's call, both are fine).
- Replace `handleCopyUrl` similarly using `urlCopy.copy(url)`.
- Update the JSX `data-copied={docNoCopy.copied ? "true" : undefined}` / `data-flipped={docNoCopy.copied ? "true" : undefined}` to read from the hook.
- Delete the now-unused `useState` import if nothing else needs it.

Commit subject: `Extract useCopyState hook to dedupe copy buttons and fix timer leak`.

### Commit 9 — Tests (issue I)

**Existing conventions to copy from** (read first):
- `src/lib/glossary.test.ts` — pure-helper test pattern (`describe`, `it`, `expect` from `vitest`, no DOM).
- `src/components/NodeContentInner.test.tsx` — component test pattern. Note it puts `// @vitest-environment jsdom` at the very top because `vitest.config.ts` only auto-applies `jsdom` to `src/components/**`. Also note its use of `@testing-library/react` (`render`, `screen`, `cleanup`), `@testing-library/user-event`, and `@testing-library/jest-dom/vitest`.

Write:
1. `src/lib/atlasHelpers.test.ts` — pure node-environment test (no `@vitest-environment` directive needed). One `describe` for `buildAncestorsWithSelf`:
   - returns the ancestor chain followed by the target node when given a regular doc-numbered node (e.g. `A.1.2.3` → `[A.1, A.1.2, A.1.2.3]`).
   - returns `[node]` (only self, no chain) for an `NR-` prefixed node — `buildAncestors` returns `[]` for those, but `WithSelf` MUST still include the node itself.
   - returns `[]` when `docs[nodeId]` is undefined (missing node — neither chain nor self).
2. `src/hooks/useCopyState.test.ts`:
   - Add `// @vitest-environment jsdom` at the top.
   - Use `vi.useFakeTimers()` / `vi.useRealTimers()` in `beforeEach` / `afterEach`.
   - Stub `navigator.clipboard.writeText` to a `vi.fn().mockResolvedValue(undefined)`.
   - Cases: `copied` is `false` initially; after `act(() => result.current.copy("hello"))` plus a `vi.runAllTimersAsync()` to flush the promise, `copied` is `true`; after `vi.advanceTimersByTime(1200)` inside an `act`, `copied` is back to `false`; calling `copy()` twice rapidly only fires one reset (the second resets the timer).
3. `src/hooks/usePulseOnChange.test.ts`:
   - Add `// @vitest-environment jsdom` at the top (jsdom is required because `renderHook` mounts a tree; the dir is NOT covered by the components-only globmatch).
   - Use `vi.useFakeTimers()` in a `beforeEach`, `vi.useRealTimers()` in `afterEach`.
   - Use `renderHook` + `act` from `@testing-library/react`.
   - Cases: initial return is `null`; changing the input to a non-null value makes return equal that value synchronously; after `vi.advanceTimersByTime(ms)` inside an `act`, return is back to `null`; rapid successive value changes flip return immediately to the latest and ultimately clear after the latest `ms` elapses.
4. `src/components/atlas/CollapsibleNode.test.tsx`:
   - `// @vitest-environment jsdom` at the top (match the existing component-test pattern even though the glob would cover it).
   - Use `render`, `fireEvent` from `@testing-library/react`. Mount with mock `onNavigate` / `onToggle` / `onShiftNavigate` vi.fn()s.
   - Construct a minimal `FlatEntry` literal — DO NOT spin up real atlas data; use a fixture object with the shape required by the type.
   - Cases:
     - Clicking the row title when `isSelected={false}` calls `onNavigate(node.id)` exactly once and does NOT call `onToggle`.
     - Clicking inside the rendered body when `isSelected={true}` (and `isExpanded={true}`) does NOT call `onNavigate` or `onToggle`.
     - Clicking the title bar when `isSelected={true}` and `hasContent={true}` calls `onToggle(node.id)`.
     - Drag-vs-click: `fireEvent.mouseDown(el, { clientX: 100, clientY: 100 })` then `fireEvent.click(el, { clientX: 110, clientY: 100 })` — `clientX` delta of 10 exceeds `DRAG_THRESHOLD_PX = 4`, MUST NOT call `onNavigate` or `onToggle`. Pair it with a same-position case (mouseDown 100,100 then click 100,100) that DOES call `onNavigate` to prove the threshold works in both directions.

Do not introduce new test dependencies; everything above is already in `package.json`.

Commit subject: `Add tests for buildAncestorsWithSelf, usePulseOnChange, useCopyState, and row click logic`.

## Forbidden actions
- MUST NOT change visible behaviour anywhere except where this prompt explicitly says (the colour values are token-equivalent; the drag threshold is the only behaviour delta and it's a strict improvement).
- MUST NOT add `Co-Authored-By: Claude …` trailers to commit messages.
- MUST NOT touch `package.json`, `vite.config.ts`, `pnpm-lock.yaml`, build artifacts, or palette-tokens.
- MUST NOT batch commits or skip commits — nine commits in the listed order.
- MUST NOT introduce a CSS animation `transitionend` listener or any other "smart" sync between JS and CSS timing — the variable is enough.

## Checkpoints (output after each commit)
After each of the nine commits, output:
1. ✅ Commit N subject — short summary of the diff
2. `git diff --stat HEAD^ HEAD` of that commit
3. The next file you intend to touch

## Stop conditions
- Stop and ask before deleting any file, adding any dependency, running `pnpm install`, or amending an earlier commit in this series.
- Stop and ask if any of the four new test files require a setup/mocking utility that does not already exist in the repo.
- Stop and ask if `pnpm tsc --noEmit` surfaces an error you cannot fix within the allowed file set.

## Verification (MUST all pass before declaring done)

After all nine commits:
1. `pnpm tsc --noEmit` — clean.
2. `pnpm test` — all tests pass, including the four new test files. (`package.json` defines `"test": "vitest run"`.)
3. `pnpm dev`, open `http://localhost:5173/redlens/atlas?id=<any-uuid>`, and visually confirm:
   a. Selecting a tree-sidebar row briefly flashes brighter then settles into `--row-selected`.
   b. Hovering a non-selected atlas row swaps its background to `--hover`.
   c. Hovering a *selected* atlas row keeps `--atlas-row-selected` — background MUST NOT swap.
   d. The breadcrumb above the main reader ends with the currently-selected node's title.
   e. Drag-text-selecting inside an expanded body does NOT navigate or toggle the row.
   f. The selected row's red left bar still appears (colour driven by `--row-color` now).
   g. Each row's chiclet strip still shows the correct depth colours.
   h. The type pill, both copy buttons (with "copied" flip), the sky-atlas external link, and the "N hidden" affordance all render and behave identically to before commit 6 — zero visible difference.
   i. The expanded body still sits indented under the title (the `marginLeft: 20` move into `.atlas-node-body`).
4. `git log --oneline -10` shows nine new commits on top of `32a3db27`, no Claude co-author trailer in any of them.
5. `git diff --stat 32a3db27..HEAD` is bounded to the allowed file list — no other files appear.

Done only when 1–5 all pass.
