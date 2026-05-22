# Reduce click-to-selection lag in the atlas list

## Context (carry forward)
RedLens is a Vite + React 19 atlas viewer. There are 10,287 atlas nodes; `AtlasView` currently re-renders ~1,200 `<CollapsibleNode>` children synchronously on every navigation (URL `?id=` change), and the selected-row CSS class cannot paint until that work commits. The user perceives a beat of lag between click and the row turning `#1f1f1f` with the red bar. The selection visual itself is pure CSS — it is gated solely on React finishing.

The fix decouples the visual selection from the URL update + tree rebuild via three changes in one file.

## Scope
Edit ONLY: `src/components/atlas/AtlasView.tsx`.

Do NOT edit: `CollapsibleNode.tsx`, `useNavigation.ts`, routing, the worker, or any test snapshots. Do NOT add new components, dependencies, abstractions, or comments beyond what the diff demands. Only make the changes listed below.

## Changes

### 1. Optimistic `selectedId` + transitioned navigation

In `AtlasView` (the same component that owns `data`, `userToggles`, etc.):

- Add `const [selectedId, setSelectedId] = useState<string | null>(id);`
- Mirror the prop into local state for external URL changes (back/forward, sidebar nav):
  ```ts
  useEffect(() => { setSelectedId(id); }, [id]);
  ```
- Wrap the incoming `onNavigate` so the local state flips synchronously and the URL update runs as a transition:
  ```ts
  const handleNavigate = useCallback((nid: string) => {
    setSelectedId(nid);
    startTransition(() => onNavigate(nid));
  }, [onNavigate]);
  ```
  `startTransition` is already imported at the top of the file — reuse it, do not re-import.
- In the `docList` `useMemo`, change `isSelected={entry.node.id === id}` to `isSelected={entry.node.id === selectedId}` and pass `onNavigate={handleNavigate}` instead of the raw `onNavigate`.
- Add `selectedId` and `handleNavigate` to the `docList` dependency array; remove `onNavigate` from that array.
- `onShiftNavigate={onSplitChange}` stays unwrapped — split-pane is not on the perf-critical path.

### 2. Stabilize `expandedSet` reference

The `expandedSet` `useMemo` (around line 148) allocates `new Set(seenExpanded.current)` on every render even when nothing changed, which churns `docList`'s dep array.

Replace it with a stable reference. The callers (`docList`, `CollapsibleNode`) only call `.has()` on it, so return `seenExpanded.current` directly:

```ts
const expandedSet = useMemo(() => {
  if (!data || !id) return ATLAS_EMPTY_SET;
  if (data.atlas.docs[id]) seenExpanded.current.add(id);
  return seenExpanded.current;
}, [data, id]);
```

### 3. Hoist `buildLookup` out of the per-id memo

Inside the right-panel `useMemo` (around line 184) `buildLookup(data.glossary)` runs on every navigation, even though it only depends on `data.glossary`. Move it to its own memo:

```ts
const glossaryLookup = useMemo(
  () => (data ? buildLookup(data.glossary) : {}),
  [data],
);
```

Then use `glossaryLookup` inside the existing right-panel `useMemo` instead of calling `buildLookup` again.

## Forbidden actions
- MUST NOT virtualize the atlas list, alter the depth-6 affordance, or refactor `JuniorPane`. Virtualization is a separate future task.
- MUST NOT introduce a `useDeferredValue` hook in addition to `startTransition` — pick one (the plan specifies `startTransition`).
- MUST NOT modify the keyframe / `.is-selected` CSS or remove the existing pulse on `TreeSidebar`.
- MUST NOT touch `pnpm-lock.yaml` or `package.json`.

## Checkpoints (output after each)
1. ✅ Change 1 applied — show the new `handleNavigate`, the mirror effect, and the updated `docList` dep array.
2. ✅ Change 2 applied — show the new `expandedSet` body.
3. ✅ Change 3 applied — show the new `glossaryLookup` memo and the line that consumes it.

## Stop conditions
- Stop and ask before deleting any file, adding any import the plan did not specify, or running `pnpm install`.
- Stop and ask if `pnpm tsc --noEmit` or `pnpm build` surfaces a type error you cannot fix inside `AtlasView.tsx` alone.

## Verification (run before declaring done)
1. `pnpm tsc --noEmit` — MUST pass.
2. `pnpm dev`, open `http://localhost:5173/redlens/atlas?id=<any-uuid>`. Click several rows. The clicked row's background MUST flip to `#1f1f1f` with the red bar within one frame of `mouseup`.
3. In Chrome DevTools → Performance, record one click. The commit that adds the `.is-selected` class to the new row MUST land in the first frame after `pointerup`; the larger `docList` reconciliation should appear in a `Transition` lane after that frame.
4. Browser back / forward MUST still update the highlighted row (the mirror effect).
5. Sidebar tree-row click MUST still select + pulse the same node in the main view.
6. Shift-click MUST still open the split pane unchanged.

Done when all six pass and only `src/components/atlas/AtlasView.tsx` shows up in `git diff --stat`.
