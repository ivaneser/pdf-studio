# Manual page-number inputs + commit timing

The slider range is also editable via two `<input type="number">` fields (start = first page, end = last page) that sit beside each document's slider. This reference covers how they are wired and the rules that govern them.

## Input markup (`renderList`)

Each field is an `<input>` with `data-role="start"` / `data-role="end"`, `min="1"`, `max="pageCount"`, `step="1"`. They replace any static span label for the range. Both are bound by event delegation in `bindRangeInputs()` after every render, so freshly-rendered fields always get handlers.

## Finding the slider DOM — structural pitfall

In `renderList` each document's markup nests the slider as a SIBLING of the range inputs, not an ancestor:

```html
<input type="number" ... data-id="<doc.id>" data-role="start">
<div class="page-slider" data-id="<doc.id>">…</div>
<input type="number" ... data-role="end">
```

Both inputs and the slider sit inside `.page-range`. So `input.closest('.page-slider')` returns **null** — a sibling never matches `.closest()` — and any handler that bails when its target is null silently attaches nothing. The whole feature looks dead with no error thrown. Anchor on something that really contains the element: read the id straight from `input.dataset.id` (the input already carries it), or walk up to the shared `.page-range`. Never assume `closest()` will reach a sibling.

## Commit timing — Enter / blur, not per keystroke

The user wants manual input only: commit on **Enter** or when the field loses focus (**blur**), NOT as each character is typed. Bind both `change` and `blur` to one handler (`applyValue`); Enter also calls it before `input.blur()`. The slider then moves to the matching position right after each commit via `refreshDocSlider()` — so range controls still "update accordingly," just on confirmation rather than live.

On commit:
1. Parse with `parseInt`, ignore empty/non-numeric.
2. Clamp raw value into `[1, pageCount]` first (this is what makes an out-of-range number "reset to cap").
3. For start: additionally clamp down to `<= doc.end`; for end: floor up to `>= doc.start`. This keeps the invariant that start <= end even during independent edits.
4. Call `store.setRange(...)` inside a `rangeEditing` guard, then `refreshDocSlider(d)` to sync just that one slider (fill + both thumbs) without a full list rebuild.

The clamp-to-cap rule is user-specified: when the user types a wrong number, it snaps to the nearest valid cap (min or max), not silently ignored and not clamped by an unrelated invariant. Raw value is clamped before the start/end ordering constraint — do the two in that order.

## Focus preservation while typing

`store.emit()` triggers `renderList()`, which rebuilds `.doc-list` and **steals focus** mid-typing. Suppress this with a module-level flag:
- `let rangeEditing = false;` set true around every `setRange` call from the input handler.
- In `store.subscribe`, skip the full render when `rangeEditing` (or while `sliderDragging`).

Without the guard, typing a multi-digit number would rebuild the list on each character and lose focus. Per-doc sync via `refreshDocSlider()` updates only the edited slider, so typing stays smooth.

## Spinner increment buttons

Number inputs render with up/down arrows by default; remove them (user wants manual input + sliders only) with:
```css
.doc-item .pr-input {
  -webkit-appearance: none; appearance: none;
  -moz-appearance: textfield;
}
.doc-item .pr-input::-webkit-outer-spin-button,
.doc-item .pr-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
```

## `refreshDocSlider(doc)` helper

Syncs one document's slider DOM to its current range without a full rebuild:
- Reposition `.ps-fill` (left/width) and both thumbs' `left` from `doc.start`/`doc.end`.
- Re-apply overlap stacking mirroring the drag handler (`liveUpdate`) — last-grabbed thumb on top via z-index:2, other hidden with opacity:0 + pointer-events:none. This keeps stacking correct after an input edit just as it does after a drag.

## Committing refreshes preview + corrects out-of-range values (critical)

`setRange()` always calls `emit()`, which runs the store subscribe handler. That handler skips the full rebuild/preview while `rangeEditing` is true:

```js
// app.js — store.subscribe
store.subscribe(() => {
  if (sliderDragging) return;
  if (rangeEditing) return;      // <-- blocks rebuild during an input edit
  renderList();
  if (store.orderedDocs.length > 0) schedulePreview();
});
```

`applyValue()` sets `rangeEditing = true`, calls `setRange()`, then resets it in a `finally`. **Before the fix**, nothing after emit ran except `refreshDocSlider(d)` — which only repositions that one slider's thumbs/fill. The result: Enter moved the slider thumb but the merged preview never rebuilt, and an out-of-range value corrected by setRange didn't visibly update. Slider drags worked because on mouseup they call `renderList()` + `schedulePreview()` directly (no rangeEditing guard).

**Fix:** in the `finally` of `applyValue`, after resetting `rangeEditing = false`, force a preview refresh:
```js
} finally {
  rangeEditing = false;
  if (store.orderedDocs.length > 0) schedulePreview();   // <-- rebuild + preview on commit
}
const d = store.docs.find((x) => x.id === input.dataset.id);
if (d) refreshDocSlider(d);
```
`schedulePreview()` is debounced (120ms), so it's cheap. This makes input commits behave like drags: slider moves AND result rebuilds, and clamped values re-render. Commit `460b6d2`.

## Verification

After edits: `node --check js/app.js` (catches syntax that would break the page silently), then curl the served JS and grep for the symbol, e.g. `curl -s http://localhost:8087/js/app.js | grep applyValue`. The server serves fresh from disk on every request — no restart needed.
