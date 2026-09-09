# Debugging pdf-studio (client-side, served from disk)

How to find and verify fixes in the no-build static app.

## The tooling reality: `js()` returns empty this session

`browser_exec`'s `page_info()` / `js(expr)` return **empty output** for js() in many cases — you cannot reliably read DOM text from the page via `js()`. Do NOT spend turns trying to coax values out of the harness. Instead:
- Use `print(...)` inside `code` (that always returns).
- Reason about behavior by reading the source and simulating logic with a **node** one-liner (`node --input-type=module -e '...'`). This is how range-clamping / index math was verified — replicate the real code path in plain JS.
- Verify a deployed change by curling the served file: `curl -s http://localhost:8087/js/app.js | grep <symbol>`.

## Verifying logic without the browser

`mergeDocs()` (js/operations.js) copies pages `[start-1 .. end-1]` per doc. To check an edit: copy the relevant clamps + index loop into a `node -e '...'` snippet and print the resulting indices / page count. This caught both the input-commit bug and confirmed narrowing to 3 pages yields exactly indices [0,1,2].

## The mergeDocs regression — debug logs broke the app silently (commit cc388ea)

While debugging this session I added `console.log(...)` calls inside `mergeDocs()`. One of them referenced a variable that does not exist in that scope (`bytes`):
```js
console.log("MERGE_DONE total_pages=", bytes.length > 0 ? "ok" : "empty"); // bytes is undefined here
```
`mergeDocs()` runs on Save/Print. A `ReferenceError` there throws, the catch shows **"Merge error: bytes is not defined"**, and **the preview never renders** — which looks exactly like "preview shows nothing". Root cause was a leftover debug line, NOT a logic bug in merge/trim.

Lesson:
- Never leave `console.log` (or any throw) inside the hot path (`mergeDocs`, `extractSingle`). Debug only with temporary probes you remove before commit.
- Symptom "Merge error: ..." + blank preview almost always = an exception thrown inside `mergeDocs()`/`extractSingle()`. Check those two functions first, before touching store/renderer/app wiring.
- The correct scope for `bytes` in `savePdf(bytes, filename)` is its parameter — not in mergeDocs where the local is `out.save()`.

## Debugging without polluting prod

If you truly need runtime logs: write a throwaway logger server to `/tmp`, have the page POST to it (same-origin so no CORS issue), read `/tmp/log.txt`, then delete everything. Do NOT commit log code. The node-simulation approach above is faster and leaves zero trace — prefer it.

## Workflow after any edit

1. `node --check js/<file>.js` — catches syntax errors that would break the whole page silently.
2. Fix only what's needed; no leftover debug lines (see mergeDocs lesson).
3. Commit with a clear message, push to main → auto-deploys via legacy Pages.
4. Verify live: `curl -s http://localhost:8087/js/<file>.js | grep <symbol>`.
