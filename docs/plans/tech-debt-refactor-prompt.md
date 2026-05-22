# Follow-up: pre-existing tech debt in atlas view (file-length splits)

## Context (carry forward)
RedLens is a Vite + React 19 atlas viewer. Two atlas-shell files violate the repo's "max ~150 lines per file" rule from `CLAUDE.md`:

| File | Lines | Target |
|---|---|---|
| `src/components/atlas/CollapsibleNode.tsx` | 316 | ~150 |
| `src/components/atlas/AtlasView.tsx` | 384 | ~150 |

Neither violation was introduced by the recent UI iteration — `CollapsibleNode` was already at 204 lines and `AtlasView` at 320 lines before commit `32a3db27`. The recent iteration **made both significantly worse** but didn't *cause* the violation. This PR addresses the pre-existing tech debt as a separate cleanup.

**Prerequisite**: This PR is intended to land *after* `pr-ready-refactor-prompt.md` so that `CollapsibleNode.tsx`'s inline-style migration has already moved a lot of JSX bulk into CSS. Run that prompt first if it hasn't been landed yet.

The repo is configured to commit as `darkstar-covenant`. **MUST NOT** add `Co-Authored-By: Claude …` trailers to any commit.

## Scope

**Allowed to edit:**
- `src/components/atlas/CollapsibleNode.tsx`
- `src/components/atlas/AtlasView.tsx`
- `src/components/tree/TreeRow.tsx` (non-null narrowing only — commit 3)
- New: `src/components/atlas/RowMeta.tsx`
- New: `src/components/atlas/RowMeta.test.tsx`
- New: `src/components/atlas/AtlasReader.tsx` (if commit 2 needs an extracted sub-component)

**MUST NOT edit:** `src/index.css` (this PR is structural only — no visual change at all), the build pipeline, `package.json`, atlas data, or anything outside `src/components/atlas/`. MUST NOT change behaviour. MUST NOT introduce new dependencies.

## Three commits — work in this order

### Commit 1 — Extract `<RowMeta>` from `CollapsibleNode.tsx`

The metaRow (type pill + two copy buttons + sky-atlas external link) is a self-contained ~100-line subtree inside `CollapsibleNode.tsx`. Extract it to its own file.

Create `src/components/atlas/RowMeta.tsx`:
```tsx
import { useCopyState } from "../../hooks/useCopyState";
import type { AtlasNode } from "../../types";

interface Props {
  node: AtlasNode;
}

export function RowMeta({ node }: Props) {
  const docNoCopy = useCopyState();
  const urlCopy = useCopyState();
  // …type pill, both copy buttons (with the inline-grid flip via .atlas-copy-flip),
  // and the sky-atlas <a> link. All JSX moved verbatim from the prior metaRow constant.
}
```

In `CollapsibleNode.tsx`:
- Replace the inline `const metaRow = (...)` definition and its JSX usage with `<RowMeta node={node} />`.
- Drop now-unused imports (`useCopyState`, the SVG-related helpers if any went with it).

Verify the rendered metaRow is byte-for-byte identical via screenshot diff (`pnpm dev` + visual check listed below).

Commit subject: `Extract RowMeta sub-component from CollapsibleNode`.

### Commit 2 — Trim `AtlasView.tsx`

`AtlasView.tsx` is 384 lines and does three loosely-related things: load data + memos, render the left-pane atlas reader, render the right-pane annotations panel + resize handle. The cleanest extraction is to pull the **left-pane** (the scroll container + split-pane toggle button + `docList` + `JuniorPane` mount) into a new `src/components/atlas/AtlasReader.tsx`.

Constraints:
- All state still lives in `AtlasView` and is passed down as props. Do NOT lift state into the new component.
- Pass the already-computed `docList: ReactElement[]` as a prop — do NOT rebuild it inside `AtlasReader`.
- Pass `id`, `splitId`, `onSplitChange`, `data`, and `scrollContainerRef` as props.
- The new file should land under ~120 lines.

`AtlasView.tsx` afterwards should be a thin coordinator under ~250 lines (still over the 150 target but a clear improvement; a follow-up could pull out more if needed).

Commit subject: `Extract AtlasReader sub-component from AtlasView`.

### Commit 3 — Narrow `TreeRow.tsx` non-null assertions

`src/components/tree/TreeRow.tsx` accesses `node!.id` at lines 114, 115, 131, 132, 162, 164. The component already early-returns on `if (!item) return null` (line 110), so the `node!` syntax is a smell — the type narrowing just wasn't carried through. Refactor:

```ts
const item = visibleNodes[index];
if (!item) return null;
const { node, hasChildren } = item;  // narrowed here
// drop every `node!` below; the destructured `node` is non-null
```

Move all `const node = item?.node` / `node?.title` access patterns to a single safe destructure after the early-return. Same for any other field referenced via `item?.`.

Commit subject: `Narrow node type in TreeRow to drop non-null assertions`.

## Forbidden actions
- MUST NOT add `Co-Authored-By: Claude …` trailers.
- MUST NOT change behaviour anywhere — the metaRow + reader extraction MUST render an identical DOM tree and produce identical event handling.
- MUST NOT touch `src/index.css`, `package.json`, `vite.config.ts`, build pipeline, or atlas data.
- MUST NOT introduce new dependencies.

## Checkpoints (output after each commit)
After each of the three commits, output:
1. ✅ Commit N subject — short summary of the diff
2. `git diff --stat HEAD^ HEAD`
3. `wc -l` for each touched component file so we can track the slimming progress.

## Stop conditions
- Stop and ask if extracting `<RowMeta>` requires importing types/utilities that don't already exist in scope.
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
5. `wc -l src/components/atlas/CollapsibleNode.tsx src/components/atlas/AtlasView.tsx src/components/atlas/RowMeta.tsx src/components/atlas/AtlasReader.tsx` — final lines should be roughly:
   - `CollapsibleNode.tsx`: ≤ 180 lines
   - `AtlasView.tsx`: ≤ 280 lines (still over target — flagged for a future PR if reviewers want)
   - `RowMeta.tsx`: ≤ 100 lines
   - `AtlasReader.tsx`: ≤ 120 lines

Done only when 1–5 all pass.
