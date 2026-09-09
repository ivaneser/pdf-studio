---
name: pdf-studio
description: Run, test and deploy the static client-side pdf-studio app.
---

# pdf-studio project rules

Use when editing or testing files under `~/myprojects/pdf-studio` (index.html, js/*.js, styles.css, lib/). This is a **static client-side app** — no build step, no npm deps. All PDF processing runs in the browser via bundled pdf-lib + PDF.js.

## Run / test locally

- Serve from disk with `python3 server.py 8087` (cwd = project root). Port **8087**.
- The server reads files fresh on every request — no restart needed after edits. Verify a change by curling the served file:
  `curl -s http://localhost:8087/js/app.js | grep <symbol>`
- `server.py` sets correct MIME types for ES modules (`.js`/`.mjs` → `application/javascript`). Do NOT swap in nginx/Apache without matching those headers or the dynamic `import('pdf-lib')` will fail to load.
- `node --check js/<file>.js` before committing — catches syntax errors that would otherwise break the whole page silently.

## Deploy (IMPORTANT — legacy Pages, not a workflow)

- Deployed via **GitHub Legacy Pages** with source = the `main` branch. Every push to `origin/main` auto-deploys. Live URL: https://ivaneser.github.io/pdf-studio/ .
- Do NOT add a `.github/workflows/pages.yml` or any Actions-based Pages workflow — GitHub allows only ONE source type per repo, and Legacy Pages + github_actions conflict (the workflow runs but the site keeps serving from main). A push to main is all that's needed.
- If unsure whether deploy config already exists: `gh api repos/ivaneser/pdf-studio/pages` shows current `build_type`. Legacy = source branch main; do not change it.

## pdf-lib API quirks (bundled lib at lib/)

The bundled pdf-lib is a non-standard build. Two gotchas that silently break:
- **No `default` export** — use a namespace import: `const mod = await import('pdf-lib'); const doc = mod.PDFDocument.load(bytes);`. A default-destructure (`const { default: PDFDocument } = ...`) throws and the code falls back to pageCount=1.
- **Method is `getPageCount()`, not `getNumberOfPages()`** — calling the wrong name throws. Both `js/store.js` (countPages) and `js/renderer.js` must use `getPageCount()`.

## Interaction state across DOM rebuilds

The list re-renders (`renderList()` → rebuilds `.doc-list`) on every store emit, which **strips all inline styles** from previously-rendered slider thumbs. Any per-thumb visual state (z-index during overlap, opacity) must therefore be:
1. Applied live in the drag handler while dragging, AND
2. Re-asserted when rebuilding each thumb (`thumbStyle()`), driven by **module-level** state that survives the rebuild — NOT a local variable inside the bind function.

See `references/interaction-debugging.md` for the full slider-overlap stacking pattern and the verification approach.

Editable start/end page-number inputs live beside each slider; their wiring, clamp-to-cap validation, focus preservation while typing, and spinner removal are documented in `references/number-input-validation.md`. When adding or changing range controls, keep them in sync with the slider via `refreshDocSlider()`. When adding any new per-element visual state, ask: "does this survive renderList()?" If not, it must be recomputed in the builder from module-level state.

## Debugging / verification

`references/debugging.md` covers how to debug this no-build app (the browser `js()` harness returns empty — reason via `node` one-liners instead), and a recurring gotcha: **debug logs left inside `mergeDocs()`/`extractSingle()` throw inside the Save/Print path, showing "Merge error" + blank preview.** Never commit log code; verify edits with `node --check` + curl.