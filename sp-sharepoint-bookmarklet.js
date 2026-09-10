// PDF Studio — SharePoint (modern list) bookmarklet.
//
// HOW TO USE:
//   1. Drag the link below to your bookmarks bar (or create a new bookmark and
//      paste the whole javascript:... code as its URL).
//   2. Open a modern SharePoint List or Document Library view.
//   3. Tick checkboxes for the PDFs you want, OR just click the bookmarklet —
//      it will ask to take all visible PDFs automatically.
//   4. Click the bookmarklet -> it opens pdf-studio and sends the files.
//
// HOW IT WORKS:
//   - Reads the currently-selected rows from the modern grid's selection model.
//     If that isn't available, falls back to scanning checked checkboxes in the DOM.
//   - If nothing is selected, asks (confirm dialog) whether to take all visible
//     PDFs in the current view.
//   - For each file it fetches the raw PDF bytes directly from SharePoint
//     (same-origin -> your login cookies are sent automatically, no auth needed).
//   - Opens https://ivaneser.github.io/pdf-studio/ via window.open() and postMessages
//     {name, bytes} into it. pdf-studio injects each file through store.add().
//
// NOTE: pdf-studio must be a public app (it is). The bookmarklet never reads or
// stores the files in SharePoint's data — it only passes raw bytes to pdf-studio.

(function () {
  var STUDIO_URL = 'https://ivaneser.github.io/pdf-studio/';

  // ---- Helpers ---------------------------------------------------------------

  function setStatus(msg) { console.log('[PDF Studio]', msg); }

  async function fetchBytes(url, signal) {
    const res = await fetch(url, { credentials: 'include', signal });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return await res.arrayBuffer();
  }

  // ---- Selection -------------------------------------------------------------
  // Modern SPFx grids expose a selection model on the root toolbar element or via
  // window globals. We try several strategies and fall back to DOM scanning.

  function getSelectedFromModel() {
    var names = [];
    // Strategy: read the grid's selection model if exposed as a global.
    try {
      var win = window;
      // Common patterns for SPFx list view globals (may not always be present).
      if (win.__spListSelection) return win.__spListSelection();
      if (win.__getSelectedItems) names = win.__getSelectedItems();
    } catch (e) {}
    return null;
  }

  // Scan the DOM for checked checkboxes within a modern grid row.
  function getSelectedFromDom() {
    var rows = [];
    // A "row" is a tr in role=grid/table, or a div[data-automation-id].
    var candidates = document.querySelectorAll('tr[role="row"], [data-automation-id^="gridRow"]');
    for (var i = 0; i < candidates.length; i++) {
      var row = candidates[i];
      // Look for a checked checkbox button in this row.
      var cb = row.querySelector('[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked');
      if (!cb) continue;
      rows.push(row);
    }
    return rows;
  }

  // From a selected row, extract the file's download URL / name.
  function urlForRow(row) {
    var a = null;
    // Prefer an anchor that points directly at a file (ends in .pdf or contains
    // "Shared Documents" / "/doclib").
    var links = row.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || '';
      if (/\.pdf(\?|$)/i.test(href) || ~href.indexOf('/Shared Documents/') || ~href.indexOf('/Document/')) {
        a = links[i];
        break;
      }
    }
    // Fallback: any anchor that looks like a file link.
    if (!a) {
      for (var j = 0; j < links.length; j++) {
        var h2 = links[j].href || '';
        if (/\.pdf(\?|$)/i.test(h2)) { a = links[j]; break; }
      }
    }
    if (!a) return null;
    var name = (a.textContent || '').trim();
    // Derive name from URL if the visible text is empty.
    if (!name) {
      try {
        var q = a.href.split('?')[0];
        name = decodeURIComponent(q.substring(q.lastIndexOf('/') + 1)) || 'file.pdf';
      } catch (e) { name = 'file.pdf'; }
    }
    return { url: a.href, name: name };
  }

  // Collect all rows that contain a .pdf file link (skip non-PDFs like .md).
  function getVisiblePdfRows() {
    var rows = [];
    var candidates = document.querySelectorAll('tr[role="row"], [data-automation-id^="gridRow"]');
    for (var i = 0; i < candidates.length; i++) {
      if (urlForRow(candidates[i])) rows.push(candidates[i]);
    }
    return rows;
  }

  // ---- Main ------------------------------------------------------------------

  async function run() {
    setStatus('Reading selection...');
    var rows = getSelectedFromDom();

    // Nothing explicitly selected -> offer to take all visible PDFs.
    if (!rows.length) {
      var allRows = getVisiblePdfRows();
      if (allRows.length === 0) {
        alert('No files found in the current view. Make sure you are on a list/library ' +
              'with visible rows, and switch to "Details" view.');
        return;
      }
      var ok = confirm(
        'Nothing is ticked yet.' +
        '\n\n' + allRows.length + ' PDF file(s) are visible in this view. ' +
        'Take all of them?' +
        '\n\nOK = take all visible PDFs\nCancel = nothing');
      if (!ok) { setStatus('Cancelled.'); return; }
      rows = allRows;
    }

    setStatus('Downloading ' + rows.length + ' file(s)...');
    var ctrl = new AbortController();
    setTimeout(function () { ctrl.abort(); }, 60000); // safety timeout

    var items = [];
    for (var i = 0; i < rows.length; i++) {
      try {
        var info = urlForRow(rows[i]);
        if (!info) continue;
        setStatus('Downloading: ' + info.name);
        var bytes = await fetchBytes(info.url, ctrl.signal);
        items.push({ name: info.name, bytes: bytes });
      } catch (e) {
        setStatus('Failed to download one file: ' + e.message);
      }
    }

    if (!items.length) {
      alert('Could not download any of the selected files. They may be protected or not valid PDFs.');
      return;
    }

    console.log('[PDF Studio] Downloaded items:', items.map(function (x) { return x.name; }));
    setStatus('Downloaded ' + items.length + ' file(s). Opening pdf-studio...');

    // Open pdf-studio, then hand over the bytes once it has loaded.
    var studio = window.open(STUDIO_URL, '_blank', 'noopener');
    if (!studio) {
      alert('Popup blocked. Allow popups for this site and try again.');
      return;
    }

    // Send after pdf-studio is ready. Poll postReady flag (set by app.js once loaded).
    var tries = 0;
    var timer = setInterval(function () {
      if (studio.closed) { clearInterval(timer); return; }
      try {
        if (studio.postMessage && studio.postReady) {
          clearInterval(timer);
          studio.postMessage({ type: 'PS_IMPORT_FILES', files: items }, '*');
          setStatus('Sent ' + items.length + ' file(s) to pdf-studio.');
          return;
        }
      } catch (e) {}
      if (++tries > 200) { // ~20s max
        clearInterval(timer);
        try { studio.postMessage({ type: 'PS_IMPORT_FILES', files: items }, '*'); } catch (e) {}
      }
    }, 100);
  }

  run();
})();
