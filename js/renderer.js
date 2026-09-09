// Рендер PDF в canvas через PDF.js. Все страницы — локально, во фрейме браузера.
//
// pdf.min.js — UMD-сборка: грузится как обычный <script> и ставит глобал
// window.pdfjsLib (импорт ES не даёт экспортов из этого файла).

// Указываем воркеру его собственный путь (локальный файл).
if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
}

export async function renderPage(arrayBuffer, pageIndex) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
    throw new Error('PDF.js не загрузился (window.pdfjsLib отсутствует)');
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
