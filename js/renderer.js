// Render PDF pages to canvas via PDF.js. All rendering is local, in the browser.
//
// pdf.min.js — UMD build: loaded as a normal <script> and sets the global
// window.pdfjsLib (ES import doesn't export anything from that file).

// Point the worker at its own path (local file).
if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
}

export async function renderPage(arrayBuffer, pageIndex) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
    throw new Error('PDF.js failed to load (window.pdfjsLib is missing)');
  }
  const data = new Uint8Array(arrayBuffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1.2 });

  const wrapper = document.createElement('div');
  wrapper.className = 'page-render';

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  wrapper.appendChild(canvas);

  // NOTE: In headless Chrome the render() promise sometimes never resolves even
  // though rendering completes (canvas already has content). Use a timeout race so
  // we don't hang forever — proceed once either the promise settles or the timeout fires.
  try {
    await Promise.race([
      page.render({ canvasContext: context, viewport }).promise,
      new Promise((resolve) => setTimeout(resolve, 15000))
    ]);
  } catch (e) {
    // Ignore — rendering may have completed anyway via the timeout path.
  }
  return { wrapper, pdf };
}
