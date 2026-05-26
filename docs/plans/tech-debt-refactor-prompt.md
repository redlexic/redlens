# Follow-up: pre-existing tech debt in atlas view (file-length splits)

## Context (carry forward)
RedLens is a Vite + React 19 atlas viewer. Two atlas-shell files violate the repo's "max ~150 lines per file" rule from `CLAUDE.md`:

| File | Lines | Target |
|---|---|---|
| `src/components/atlas/AtlasView.tsx` | 369 | ~150 |

`CollapsibleNode.tsx` is resolved — the meta row was extracted as `NodeMeta.tsx` (conditionally mounted when `isSelected`, 143 lines). `AtlasView.tsx` remains over target.

**Prerequisite**: This PR is intended to land *after* `pr-ready-refactor-prompt.md` so that `CollapsibleNode.tsx`'s inline-style migration has already moved a lot of JSX bulk into CSS. Run that prompt first if it hasn't been landed yet.

The repo is configured to commit as `darkstar-covenant`. **MUST NOT** add `Co-Authored-By: Claude …` trailers to any commit.

## Scope

**Allowed to edit:**
- `src/components/atlas/CollapsibleNode.tsx`
- `src/components/atlas/AtlasView.tsx`
- `src/components/tree/TreeRow.tsx` (non-null narrowing only — commit 2)
- New: `src/components/atlas/AtlasReader.tsx` (if commit 1 needs an extracted sub-component)

**MUST NOT edit:** `src/index.css` (this PR is structural only — no visual change at all), the build pipeline, `package.json`, atlas data, or anything outside `src/components/atlas/`. MUST NOT change behaviour. MUST NOT introduce new dependencies.

## Two commits — work in this order

### Commit 1 — Trim `AtlasView.tsx`

`AtlasView.tsx` is 384 lines and does three loosely-related things: load data + memos, render the left-pane atlas reader, render the right-pane annotations panel + resize handle. The cleanest extraction is to pull the **left-pane** (the scroll container + split-pane toggle button + `docList` + `JuniorPane` mount) into a new `src/components/atlas/AtlasReader.tsx`.

Constraints:
- All state still lives in `AtlasView` and is passed down as props. Do NOT lift state into the new component.
- Pass the already-computed `docList: ReactElement[]` as a prop — do NOT rebuild it inside `AtlasReader`.
- Pass `id`, `splitId`, `onSplitChange`, `data`, and `scrollContainerRef` as props.
- The new file should land under ~120 lines.

`AtlasView.tsx` afterwards should be a thin coordinator under ~250 lines (still over the 150 target but a clear improvement; a follow-up could pull out more if needed).

Commit subject: `Extract AtlasReader sub-component from AtlasView`.

### Commit 2 — Narrow `TreeRow.tsx` non-null assertions

`src/components/tree/TreeRow.tsx` accesses `node!.id`. The component already early-returns on `if (!item) return null` after the hooks, so the `node!` syntax is a smell — the type narrowing just wasn't carried through. Note: hooks must be called unconditionally, so the early return must stay *after* the `useMemo` calls. The fix is:

```ts
const item = visibleNodes[index];
const node = item?.node;
// ...useMemo hooks stay here, using docNo/title/treeDepth derived above...
if (!item || !node) return null;
const { hasChildren } = item;
// drop every `node!` below; node is AtlasNode here
```

Commit subject: `Narrow node type in TreeRow to drop non-null assertions`.

## Forbidden actions
- MUST NOT add `Co-Authored-By: Claude …` trailers.
- MUST NOT change behaviour anywhere — the metaRow + reader extraction MUST render an identical DOM tree and produce identical event handling.
- MUST NOT touch `src/index.css`, `package.json`, `vite.config.ts`, build pipeline, or atlas data.
- MUST NOT introduce new dependencies.

## Checkpoints (output after each commit)
After each of the two commits, output:
1. ✅ Commit N subject — short summary of the diff
2. `git diff --stat HEAD^ HEAD`
3. `wc -l` for each touched component file so we can track the slimming progress.

## Stop conditions
- Stop and ask if `AtlasView` cannot be reduced to under 280 lines without restructuring state (which is out of scope for this PR).

## Verification

After all three commits:
1. `pnpm tsc --noEmit` — clean.
2. `pnpm test` — all tests pass (including any inherited tests for the extracted components if `CollapsibleNode.test.tsx` was the first prompt's test file).
3. `pnpm dev`, open `http://localhost:5173/redlens/atlas?id=<any-uuid>`. Visually confirm zero diff:
   a. The type pill, both copy buttons (with "copied" flip), and sky-atlas link render identically.
   b. Clicking either copy button still copies the right thing and flips for ~1.2 s.
   c. Atlas list scrolls, expands, navigates as before.
   d. Shift-click still opens the split pane; closing it works.
   e. Right panel still renders annotations / glossary / history correctly.
4. `git diff --stat <previous-PR-tip>..HEAD` — only the four files listed in **Scope** appear, no `src/index.css`, no test config, no data artifacts.
5. `wc -l src/components/atlas/AtlasView.tsx src/components/atlas/AtlasReader.tsx` — final lines should be roughly:
   - `AtlasView.tsx`: ≤ 280 lines (still over target — flagged for a future PR if reviewers want)
   - `AtlasReader.tsx`: ≤ 120 lines

Done only when 1–5 all pass.
