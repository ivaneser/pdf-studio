// Main app logic: wires store, rendering and UI operations together.

import { store } from './store.js';
import { mergeDocs, extractSingle, savePdf } from './operations.js';
import { renderPage } from './renderer.js';

const fileInput = document.getElementById('fileInput');
const addBtn = document.getElementById('addBtn');
const docList = document.getElementById('docList');
const canvasArea = document.getElementById('canvasArea');
const dropHint = document.getElementById('dropHint');
const mergeBtn = document.getElementById('mergeBtn');
const printBtn = document.getElementById('printBtn');
const statusText = document.getElementById('statusText');

function setStatus(msg) {
  statusText.textContent = msg;
}

async function handleFiles(files) {
  for (const file of files) {
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      setStatus(`Skipped: ${file.name} — not a PDF`);
      continue;
    }
    try {
      const bytes = await file.arrayBuffer();
      await store.add(bytes, file.name);
      setStatus(`Loaded: ${file.name}`);
    } catch (err) {
      setStatus(`Failed to load ${file.name}: ${err.message}`);
    }
  }
}

addBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = '';
});

// Drag & drop
['dragenter', 'dragover'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    dropHint.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    dropHint.classList.remove('dragover');
  });
});
window.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// Render the selected document / result
async function renderPreview() {
  canvasArea.innerHTML = '';
  const docs = store.orderedDocs;
  if (docs.length === 0) {
    dropHint.style.display = 'flex';
    return;
  }
  dropHint.style.display = 'none';

  // One doc -> show its pages, otherwise show the merge preview
  const previewDocs = docs.length === 1 ? [docs[0]] : docs;
  for (const doc of previewDocs) {
    const count = doc.pageCount; // full preview — all pages
    setStatus(`View: ${doc.name}`);
    for (let p = 0; p < count; p++) {
      try {
        const { wrapper } = await renderPage(doc.bytes, p);
        canvasArea.appendChild(wrapper);
      } catch (err) {
        setStatus(`Could not render ${doc.name} page ${p + 1}: ${err.message}`);
      }
    }
  }
}

// Render the merge result before printing/downloading
let lastMergeBytes = null;
async function buildPreview() {
  const docs = store.orderedDocs;
  if (docs.length === 0) return;
  setStatus('Building preview...');
  try {
    // Print/download everything in range
    lastMergeBytes = await mergeDocs(docs);
    renderPreviewMerged(lastMergeBytes);
    setStatus(`Done: ${docs.length} doc(s)`);
  } catch (err) {
    setStatus(`Merge error: ${err.message}`);
  }
}

async function renderPreviewMerged(bytes) {
  canvasArea.innerHTML = '';
  dropHint.style.display = 'none';
  try {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
      throw new Error('PDF.js failed to load (window.pdfjsLib is missing)');
    }
    const data = new Uint8Array(bytes);
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const count = doc.numPages; // full preview — all pages
    for (let p = 1; p <= count; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1.1 });
      const wrapper = document.createElement('div');
      wrapper.className = 'page-render';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      wrapper.appendChild(canvas);
      canvasArea.appendChild(wrapper);
      await page.render({ canvasContext: ctx, viewport }).promise;
    }
  } catch (err) {
    setStatus(`Could not render merge: ${err.message}`);
  }
}

// Build a single slider thumb element for a doc. When the doc's start===end both
// thumbs sit at the same left position (they "glue" together), so DOM order would
// make .ps-end always paint on top of .ps-start and dragging `start` onto `end`
// would leave `start` unreachable. We bring the last-grabbed thumb to the front via
// z-index and hide the other with opacity:0 + pointer-events:none (the CSS rule
// handles the latter). This mirrors the liveUpdate() overlap logic so stacking is
// correct even after renderList(), which rebuilds every slider and strips inline
// styles.
function thumbStyle(field, doc, pct) {
  const cls = field === 'start' ? 'ps-thumb ps-start' : 'ps-thumb ps-end';
  const style = `left:${pct}%`;
  if (doc.start !== doc.end) return `<div class="${cls}" data-field="${field}" style="${style}"></div>`;
  // Overlap: both thumbs sit at the same left position, so DOM order decides stacking.
  // .ps-end is later in the DOM and always paints on top of .ps-start — which would
  // leave `start` unreachable. Bring the last-grabbed thumb to the front (z-index 2)
  // and hide the other (opacity:0 + pointer-events:none via CSS). Default to `end`
  // when nothing has been grabbed yet so a freshly-rendered merged slider is grabbable.
  const onTopThumb = lastGrabbed || 'end';
  if (field === onTopThumb) {
    return `<div class="${cls}" data-field="${field}" style="${style};z-index:2;opacity:1;top:-3px"></div>`;
  }
  return `<div class="${cls}" data-field="${field}" style="${style};z-index:1;opacity:0"></div>`;
}

// Sync ONE document's slider DOM (fill + thumb positions + overlap stacking) and its
// start/end inputs WITHOUT rebuilding the whole list. Used while editing the page-number
// inputs so typing doesn't lose focus, and during a live drag settle.
function refreshDocSlider(doc) {
  const slider = docList.querySelector(`.page-slider[data-id="${doc.id}"]`);
  if (!slider) return;
  const pctStart = Math.max(0, Math.min(100, ((doc.start - 1) / Math.max(1, doc.pageCount - 1)) * 100));
  const pctEnd = Math.max(pctStart, Math.min(100, ((doc.end - 1) / Math.max(1, doc.pageCount - 1)) * 100));
  const fill = slider.querySelector('.ps-fill');
  if (fill) { fill.style.left = pctStart + '%'; fill.style.width = (pctEnd - pctStart) + '%'; }
  const startThumb = slider.querySelector('.ps-start');
  const endThumb = slider.querySelector('.ps-end');
  if (startThumb) startThumb.style.left = pctStart + '%';
  if (endThumb) endThumb.style.left = pctEnd + '%';
  // When the thumbs overlap they sit at the same left position; keep only one grabbable.
  // Mirror liveUpdate(): bring last-grabbed thumb to front (z-index:2), hide the other via
  // opacity:0 (CSS rule .ps-thumb[style*="opacity: 0"] { pointer-events: none }).
  if (startThumb && endThumb) {
    const overlap = Math.abs(pctStart - pctEnd) < 0.5;
    if (overlap) {
      const active = lastGrabbed === 'end' ? endThumb : startThumb;
      const other = active === startThumb ? endThumb : startThumb;
      active.style.opacity = '1';
      active.style.top = '-3px';
      active.style.zIndex = '2';
      other.style.opacity = '0';
      other.style.zIndex = '1';
    } else {
      startThumb.style.opacity = '1';
      endThumb.style.opacity = '1';
      startThumb.style.top = '-3px';
      endThumb.style.top = '-3px';
    }
  }
  const inStart = slider.querySelector('[data-role="start"]');
  const inEnd = slider.querySelector('[data-role="end"]');
  if (inStart) inStart.value = doc.start;
  if (inEnd) inEnd.value = doc.end;
}

// Document list
function renderList() {
  const docs = store.orderedDocs;
  docList.innerHTML = '';
  mergeBtn.disabled = docs.length === 0;
  printBtn.disabled = docs.length === 0;

  docs.forEach((doc) => {
    const li = document.createElement('li');
    li.className = 'doc-item';
    li.dataset.id = doc.id; // REQUIRED: the drop handler reads li.dataset.id,
    // without it reorderByIds gets [undefined,...] -> docs ⟶ [] -> cards vanish
    const pctStart = Math.max(0, Math.min(100, ((doc.start - 1) / Math.max(1, doc.pageCount - 1)) * 100));
    const pctEnd = Math.max(pctStart, Math.min(100, ((doc.end - 1) / Math.max(1, doc.pageCount - 1)) * 100));
    li.innerHTML = `
      <div class="name-row">
        <button class="btn-del" data-id="${doc.id}" title="Delete">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
        <div class="name" draggable="true">${doc.name}</div>
      </div>
      <div class="page-range">
        <input type="number" class="pr-input pr-start" data-role="start" data-id="${doc.id}" min="1" max="${doc.pageCount}" value="${doc.start}" step="1">
        <div class="page-slider" data-id="${doc.id}">
          <div class="ps-track">
            <div class="ps-fill" style="left:${pctStart}%;width:${pctEnd - pctStart}%"></div>
            ${thumbStyle('start', doc, pctStart)}
            ${thumbStyle('end', doc, pctEnd)}
          </div>
        </div>
        <input type="number" class="pr-input pr-end" data-role="end" data-id="${doc.id}" min="1" max="${doc.pageCount}" value="${doc.end}" step="1">
      </div>
    `;
    docList.appendChild(li);
    // Drag ONLY by the document name, not the whole card.
    const nameEl = li.querySelector('.name');
    nameEl._dragId = doc.id;
  });

  // Own drag handler for the slider: thumb moves with the mouse, no conflict with card DnD.
  docList.querySelectorAll('.page-slider').forEach((slider) => bindSlider(slider));
  // Bind start/end page-number inputs so they can be edited directly (see bindRangeInputs).
  bindRangeInputs();
}

// Bind keyboard handlers on the start/end page-number inputs so they can be edited
// directly. Constraints (start in [1, pageCount], end in [1, pageCount], start <= end,
// end >= start) are enforced by store.setRange(). A full renderList() is suppressed while
// editing (rangeEditing flag) so focus isn't lost mid-typing; instead just that one slider
// is synced via refreshDocSlider().
function bindRangeInputs() {
  docList.querySelectorAll('input[data-role="start"], input[data-role="end"]').forEach((input) => {
    // The slider is a SIBLING of the input (both live inside `.page-range`), so we
    // can't use closest(); read the id straight from the input, which already has it.
    const doc = store.docs.find((d) => d.id === input.dataset.id);
    if (!doc) return;

    const applyValue = () => {
      const raw = parseInt(input.value, 10);
      if (Number.isNaN(raw)) return; // ignore empty / non-numeric input
      const role = input.dataset.role;
      let value = Math.max(1, Math.min(doc.pageCount, raw));
      rangeEditing = true;
      try {
        if (role === 'start') {
          // start must stay <= current end — clamp down rather than extending end.
          store.setRange(doc.id, Math.min(value, doc.end), doc.end);
        } else {
          // end must stay >= current start — floor up rather than lowering start.
          store.setRange(doc.id, doc.start, Math.max(value, doc.start));
        }
      } finally {
        rangeEditing = false;
        // setRange() emitted while rangeEditing was true, so the subscribe handler
        // skipped the rebuild/preview. Force one preview refresh now so narrowed
        // ranges actually update the result (and corrected values re-render).
        if (store.orderedDocs.length > 0) schedulePreview();
      }
      const d = store.docs.find((x) => x.id === input.dataset.id);
      if (d) refreshDocSlider(d);
    };

    // Commit on Enter or when the field loses focus — NOT instant per keystroke.
    // The slider moves to the matching position right after each commit.
    input.addEventListener('change', applyValue);
    input.addEventListener('blur', applyValue);
    // Enter commits without losing focus first, then blurs (double-safe).
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyValue();
        input.blur();
      }
    });
  });
}

// Build preview once, then debounce further calls by 120ms. store.emit() fires on
// every thumb mousemove during a drag; buildPreview() is an async PDF merge that
// wipes canvasArea and re-renders pages each time — firing it per pixel spawns
// dozens of concurrent merges clobbering the same canvas, which looks like pages
// multiplying instead of trimming. Coalesce them into one rebuild after settling.
let previewTimer = null;
let pendingPreview = false;
// Tracks whether an async build is currently in flight so schedulePreview() can
// coalesce its ~10 calls-per-second into a single rebuild after settling.
let buildingPreview = false;
// While dragging the slider — DON'T emit() to rebuild the list and preview.
// liveUpdate itself updates only this slider, then on mouseup we do one full rebuild.
let sliderDragging = false;
// True while editing the start/end page-number inputs. Suppresses the full renderList()
// rebuild on store.emit() so typing doesn't steal focus — we sync only that one slider via
// refreshDocSlider(). Set around setRange(); reset after (before any pending async work).
let rangeEditing = false;
// Which thumb was grabbed last (module scope so it survives renderList(), which
// rebuilds the whole list and strips inline styles). When a doc's start===end
// both thumbs sit at the same left position, so we bring this one to the front.
let lastGrabbed = null;
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  const run = () => {
    previewTimer = null;
    if (buildingPreview) { pendingPreview = true; return; }
    buildingPreview = true;
    buildPreview().finally(() => {
      buildingPreview = false;
      if (pendingPreview) { pendingPreview = false; schedulePreview(); }
    });
  };
  previewTimer = setTimeout(run, 120);
}

store.subscribe(() => {
  // During slider drag DON'T rebuild the list and preview — liveUpdate itself
  // precisely updates only this slider so the thumb doesn't "jump" from rebuild.
  if (sliderDragging) return;
  // While editing start/end inputs, don't rebuild the whole list either (it would steal
  // focus mid-typing). refreshDocSlider() syncs just that one slider instead.
  if (rangeEditing) return;
  renderList();
  if (store.orderedDocs.length > 0) schedulePreview();
});

// Drag & drop for changing card order (order = merge order).
// Move DOM elements directly during dragover — they "glue" smoothly.
// In store we only fix the final order on drop.
let dragId = null;
docList.addEventListener('dragstart', (e) => {
  // Drag ONLY by the document name, not the whole card or the slider.
  const nameEl = e.target.closest('.name');
  if (!nameEl || !nameEl._dragId) return;
  dragId = nameEl._dragId;
  const li = nameEl.closest('.doc-item');
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';

  // Custom drag preview — shows the WHOLE card, not just the name text:
  // clone .doc-item, hide it off-screen and pass it as the drag-image.
  const ghost = li.cloneNode(true);
  Object.assign(ghost.style, {
    position: 'absolute', top: '-9999px', left: '-9999px',
    opacity: '0.92', transform: 'none', pointerEvents: 'none',
    zIndex: '-1',
  });
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 40, 20);
  // Remove the clone after the browser has copied it into the drag image.
  requestAnimationFrame(() => ghost.remove());
});
docList.addEventListener('dragend', (e) => {
  const li = e.target.closest('.doc-item');
  if (li) li.classList.remove('dragging');
  dragId = null;
});
docList.addEventListener('dragover', (e) => {
  if (!dragId) return;
  e.preventDefault(); // allow drop
  const target = e.target.closest('.doc-item');
  if (!target || target.dataset.id === dragId) return;

  const rect = target.getBoundingClientRect();
  const afterTarget = (e.clientY - rect.top) > rect.height / 2;
  const draggedEl = docList.querySelector(`.doc-item[data-id="${dragId}"]`);
  if (!draggedEl) return;

  // Insert the dragged element relative to the TARGET element:
  // before it (top half) or after it (bottom half).
  // insertAdjacentElement always places dragged relative to a fixed target,
  // regardless of where dragged currently is.
  if (afterTarget) {
    target.insertAdjacentElement('afterend', draggedEl);
  } else {
    target.insertAdjacentElement('beforebegin', draggedEl);
  }
});
docList.addEventListener('drop', () => {
  // Fix the new card order from the DOM into store.
  const ids = [...docList.querySelectorAll('.doc-item')].map((li) => li.dataset.id);
  if (ids.length) store.reorderByIds(ids);
  dragId = null;
});

// Mobile drag for changing card order: mouse/drag-and-drop only works on desktop,
// so here's a separate system on touch events. Hold your finger on the name
// >300ms (long-press) → start dragging → move your finger, smoothly "gluing"
// to adjacent cards → release → fix the order in store.
let touchDragId = null;
let touchDragEl = null;
let touchMoved = false;
const LONG_PRESS_MS = 300;
let longPressTimer = null;

function cardForTouch(ev) {
  const t = ev.touches ? ev.touches[0] : ev;
  return document.elementFromPoint(t.clientX, t.clientY)?.closest('.doc-item') || null;
}

docList.addEventListener('touchstart', (e) => {
  const nameEl = e.target.closest('.name');
  if (!nameEl || !nameEl._dragId) return;
  touchDragId = nameEl._dragId;
  touchMoved = false;
  longPressTimer = setTimeout(() => {
    touchDragEl = docList.querySelector(`.doc-item[data-id="${touchDragId}"]`);
    if (!touchDragEl) return;
    touchDragEl.classList.add('dragging');
    // Block scrolling/selecting while dragging the card.
    document.body.style.userSelect = 'none';
    document.body.style.overflow = 'hidden';
  }, LONG_PRESS_MS);
}, { passive: true });

docList.addEventListener('touchmove', (e) => {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  if (!touchDragEl) return;
  touchMoved = true;
  e.preventDefault(); // don't let the page scroll by finger

  const y = e.touches[0].clientY;
  const target = cardForTouch(e);
  if (!target || target === touchDragEl || target.dataset.id === touchDragId) return;

  const rect = target.getBoundingClientRect();
  const afterTarget = (y - rect.top) > rect.height / 2;
  if (afterTarget) {
    target.insertAdjacentElement('afterend', touchDragEl);
  } else {
    target.insertAdjacentElement('beforebegin', touchDragEl);
  }
}, { passive: false });

docList.addEventListener('touchend', () => {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  if (touchDragEl) {
    touchDragEl.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.overflow = '';
    // Fix the order only if we actually dragged — otherwise don't break tap.
    if (touchMoved) {
      const ids = [...docList.querySelectorAll('.doc-item')].map((li) => li.dataset.id);
      if (ids.length) store.reorderByIds(ids);
    }
  }
  touchDragId = null;
  touchDragEl = null;
  touchMoved = false;
});

// Own drag handler for the slider — thumb moves with the mouse, no conflict with card DnD.
// Positions are discrete: thumb snaps to whole page numbers (1..pageCount), not pixels.
function bindSlider(slider) {
  const doc = store.docs.find((d) => d.id === slider.dataset.id);
  if (!doc) return;
  const track = slider.querySelector('.ps-track');
  let field = null;

  // Update ONLY this slider: fill, thumb positions and numeric labels.
  // DON'T rebuild the whole list (renderList) — otherwise every mousemove during
  // drag triggers a full card rebuild, which makes the slider "jump" to an edge.
  const liveUpdate = (start, end) => {
    const pctStart = ((start - 1) / Math.max(1, doc.pageCount - 1)) * 100;
    const pctEnd = ((end - 1) / Math.max(1, doc.pageCount - 1)) * 100;
    const fill = slider.querySelector('.ps-fill');
    if (fill) {
      fill.style.left = pctStart + '%';
      fill.style.width = (pctEnd - pctStart) + '%';
    }
    const startThumb = slider.querySelector('.ps-start');
    const endThumb = slider.querySelector('.ps-end');
    if (startThumb) startThumb.style.left = pctStart + '%';
    if (endThumb) endThumb.style.left = pctEnd + '%';

    // The two thumbs "glue" together when their pages match. Then they overlap
    // visually and the bottom one can't be reached by finger/mouse. We used to
    // shift them vertically — that's awkward on mobile. Now, when merging, we show
    // and keep active ONLY the thumb grabbed last (lastGrabbed): it's under the
    // finger, while the other is hidden (opacity: 0) so it can't be dragged by
    // mistake. When pages separate again — both return to their default position.
    if (startThumb && endThumb) {
      const overlap = Math.abs(pctStart - pctEnd) < 0.5;
      if (overlap) {
        // When the thumbs sit on the same page they paint at the exact same left
        // position, so DOM order decides stacking and .ps-end always lands on top of
        // .ps-start — which means dragging start forward onto end makes start
        // unreachable. Bring the last-grabbed thumb to the front via z-index so it's
        // the one that receives clicks/touches; hide the other with opacity +
        // pointer-events:none (handled by the CSS rule below). Splitting again returns
        // both thumbs to their default stacking.
        const active = lastGrabbed === 'end' ? endThumb : startThumb;
        const other = active === startThumb ? endThumb : startThumb;
        active.style.opacity = '1';
        active.style.top = '-3px';
        active.style.zIndex = '2';
        other.style.opacity = '0';
        other.style.zIndex = '1';
      } else {
        startThumb.style.opacity = '1';
        endThumb.style.opacity = '1';
        startThumb.style.top = '-3px';
        endThumb.style.top = '-3px';
      }
    }

    // Numeric labels: the first page number before the slider, the last after.
    const range = slider.closest('.page-range');
    if (range) {
      const startLabel = range.querySelector('[data-role="start"]');
      const endLabel = range.querySelector('[data-role="end"]');
      // These are now <input type=number>, so set .value, not textContent.
      if (startLabel) startLabel.value = start;
      if (endLabel) endLabel.value = end;
    }
  };

  // percent → whole page (1..pageCount). Math.round gives discrete steps.
  const pageFromPct = (pct) => {
    return Math.max(1, Math.min(doc.pageCount, Math.round((pct / 100) * (doc.pageCount - 1)) + 1));
  };

  const pctFromClientX = (x) => {
    const rect = track.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100));
  };

  // Quantization accuracy: a slider of length L px gives a step ~L/pageCount.
  // Limit the minimum step (0.5 pages) so "flicker" at the edges doesn't shake the thumb.
  const minStep = Math.max(1, doc.pageCount / track.getBoundingClientRect().width);

  const commit = (pct) => {
    let page = pageFromPct(pct);
    // Quantize to step — remove fractional "jumps" between whole pages.
    if (field === 'start') {
      const quantized = Math.max(1, Math.min(doc.end, Math.round(page / minStep) * minStep));
      store.setRange(doc.id, quantized, doc.end);
    } else {
      const quantized = Math.min(doc.pageCount, Math.max(doc.start, Math.round(page / minStep) * minStep));
      store.setRange(doc.id, doc.start, quantized);
    }
    // Live update of this slider — without rebuilding the whole list.
    const d = store.docs.find((x) => x.id === slider.dataset.id);
    if (d) liveUpdate(d.start, d.end);
  };

  const onDown = (e) => {
    const thumb = e.target.closest('.ps-thumb');
    if (!thumb || !thumb.dataset.field) return;
    field = thumb.dataset.field;
    // Remember exactly which thumb we just grabbed — so when merging it's the one
    // shown/kept active. Tracked at module scope (not here) because renderList(),
    // called on release, rebuilds every slider and strips inline styles; this value
    // must survive that so both thumbs stack correctly after every drag.
    lastGrabbed = field;
    sliderDragging = true;

    // Own drag — don't let events leak to card/DnD. Support both mouse and touch:
    // on mobile mousemove doesn't fire, so there we catch touchmove.
    if (e.cancelable) e.preventDefault();
    document.body.style.userSelect = 'none';

    // X-coordinate for any event type (mouse or finger).
    const getX = (ev) => {
      if (ev.touches && ev.touches.length > 0) return ev.touches[0].clientX;
      return ev.clientX;
    };

    const move = (ev) => {
      commit(pctFromClientX(getX(ev)));
      // Block page scrolling by finger while dragging the slider.
      if (ev.cancelable && ev.touches && ev.touches.length > 0) ev.preventDefault();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      document.body.style.userSelect = '';
      field = null;
      sliderDragging = false;
      // One clean rebuild after drag ends — sync the list and preview.
      renderList();
      if (store.orderedDocs.length > 0) schedulePreview();
    };

    const hasTouch = e.touches && e.touches.length > 0;
    if (hasTouch) {
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', up);
    } else {
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }
  };

  slider.addEventListener('mousedown', onDown);
  // On mobile mousemove doesn't fire — catch touchstart. NOT passive, so we can
  // preventDefault and block page scrolling when a drag starts.
  slider.addEventListener('touchstart', onDown);
}

docList.addEventListener('click', (e) => {
  const delBtn = e.target.closest('.btn-del');
  if (delBtn) {
    store.remove(delBtn.dataset.id);
    setStatus('Document deleted');
  }
});

mergeBtn.addEventListener('click', async () => {
  try {
    console.log("SAVE", store.docs.map(d => ({name:d.name, start:d.start, end:d.end, pageCount:d.pageCount})));
    const bytes = await mergeDocs(store.orderedDocs);
    const name = `merged_${Date.now()}.pdf`;
    await savePdf(bytes, name);
    setStatus(`Merged and downloaded: ${name}`);
  } catch (err) {
    setStatus(`Merge error: ${err.message}`);
  }
});

printBtn.addEventListener('click', async () => {
  try {
    const bytes = await mergeDocs(store.orderedDocs);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    // Print PDF via iframe — vector quality, file never leaves the browser
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    iframe.src = url;
    iframe.addEventListener('load', () => {
      setTimeout(() => {
        try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); }
        catch (e) { setStatus(`Print error: ${e.message}`); }
        finally { iframe.remove(); URL.revokeObjectURL(url); }
      }, 500);
    });
  } catch (err) {
    setStatus(`Print error: ${err.message}`);
  }
});

// External file injection (from an external app via postMessage).
// Receives { type: 'PS_IMPORT_FILES', files: [{ name, bytes }] } via postMessage.
// `bytes` may be an ArrayBuffer, Uint8Array or Blob — normalise to ArrayBuffer and
// push each file through store.add() so the existing render/list/merge pipeline
// handles it unchanged.
async function importExternalFiles(files) {
  setStatus(`Importing ${files.length} file(s) from another app...`);
  for (const f of files) {
    try {
      let bytes = f.bytes;
      if (bytes instanceof Blob) bytes = await bytes.arrayBuffer();
      else if (!(bytes instanceof ArrayBuffer)) bytes = new Uint8Array(bytes).buffer;
      await store.add(bytes, f.name);
    } catch (err) {
      setStatus(`Failed to import ${f.name}: ${err.message}`);
    }
  }
}

window.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || data.type !== 'PS_IMPORT_FILES' || !Array.isArray(data.files)) return;
  // pdf-studio is a public app, so any window holding our handle is the bookmarklet
  // that opened us. Accept all PS_IMPORT_FILES messages.
  importExternalFiles(data.files);
});

// Initialization — empty list
renderList();

// Signal to external windows (via postMessage) that we are loaded
// and can receive postMessage { type: 'PS_IMPORT_FILES', files }.
window.postReady = true;
