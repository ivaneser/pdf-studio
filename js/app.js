// Главная логика приложения: связывает store, рендер и операции в UI.

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
      setStatus(`Пропущено: ${file.name} — не PDF`);
      continue;
    }
    try {
      const bytes = await file.arrayBuffer();
      await store.add(bytes, file.name);
      setStatus(`Загружено: ${file.name}`);
    } catch (err) {
      setStatus(`Ошибка загрузки ${file.name}: ${err.message}`);
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

// Рендер выбранного документа / итога
async function renderPreview() {
  canvasArea.innerHTML = '';
  const docs = store.orderedDocs;
  if (docs.length === 0) {
    dropHint.style.display = 'flex';
    return;
  }
  dropHint.style.display = 'none';

  // Если выбран один документ — показываем его страницы, иначе — слияние-превью
  const previewDocs = docs.length === 1 ? [docs[0]] : docs;
  for (const doc of previewDocs) {
    const count = Math.min(doc.pageCount, 3); // превью первых 3 страниц
    setStatus(`Просмотр: ${doc.name}`);
    for (let p = 0; p < count; p++) {
      try {
        const { wrapper } = await renderPage(doc.bytes, p);
        canvasArea.appendChild(wrapper);
      } catch (err) {
        setStatus(`Не удалось отрисовать ${doc.name} стр. ${p + 1}: ${err.message}`);
      }
    }
  }
}

// Рендер результата слияния перед печатью/скачиванием
let lastMergeBytes = null;
async function buildPreview() {
  const docs = store.orderedDocs;
  if (docs.length === 0) return;
  setStatus('Формирование превью...');
  try {
    // Печатать/скачивать будем всё, что в диапазоне
    lastMergeBytes = await mergeDocs(docs);
    renderPreviewMerged(lastMergeBytes);
    setStatus(`Готово: ${docs.length} док.`);
  } catch (err) {
    setStatus(`Ошибка слияния: ${err.message}`);
  }
}

async function renderPreviewMerged(bytes) {
  canvasArea.innerHTML = '';
  dropHint.style.display = 'none';
  try {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
      throw new Error('PDF.js не загрузился (window.pdfjsLib отсутствует)');
    }
    const data = new Uint8Array(bytes);
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const count = Math.min(doc.numPages, 10);
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
    setStatus(`Не удалось отрисовать слияние: ${err.message}`);
  }
}

// Список документов
function renderList() {
  const docs = store.orderedDocs;
  docList.innerHTML = '';
  mergeBtn.disabled = docs.length === 0;
  printBtn.disabled = docs.length === 0;

  docs.forEach((doc) => {
    const li = document.createElement('li');
    li.className = 'doc-item';
    li.innerHTML = `
      <div class="name">${doc.name}</div>
      <div class="meta">${doc.pageCount} стр.</div>
      <div class="page-range">
        <input type="number" min="1" max="${doc.pageCount}" value="${doc.start}" data-id="${doc.id}" data-field="start" />
        <span class="range-sep">—</span>
        <input type="number" min="1" max="${doc.pageCount}" value="${doc.end}" data-id="${doc.id}" data-field="end" />
      </div>
      <button class="btn-del" data-id="${doc.id}">Удалить</button>
    `;
    docList.appendChild(li);
  });
}

store.subscribe(() => {
  renderList();
  if (store.orderedDocs.length > 0) buildPreview();
});

docList.addEventListener('change', (e) => {
  const target = e.target;
  const id = target.dataset.id;
  const field = target.dataset.field;
  const doc = store.docs.find((d) => d.id === id);
  if (!doc) return;
  const val = parseInt(target.value, 10) || (field === 'start' ? 1 : doc.pageCount);
  store.setRange(id, field === 'start' ? val : doc.start, field === 'end' ? val : doc.end);
});

docList.addEventListener('click', (e) => {
  const target = e.target;
  if (target.classList.contains('btn-del')) {
    store.remove(target.dataset.id);
    setStatus('Документ удалён');
  }
});

mergeBtn.addEventListener('click', async () => {
  try {
    const bytes = await mergeDocs(store.orderedDocs);
    const name = `merged_${Date.now()}.pdf`;
    await savePdf(bytes, name);
    setStatus(`Слито и скачано: ${name}`);
  } catch (err) {
    setStatus(`Ошибка слияния: ${err.message}`);
  }
});

printBtn.addEventListener('click', async () => {
  try {
    const bytes = await mergeDocs(store.orderedDocs);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    // Печать PDF через iframe — векторное качество, файл не покидает браузер
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
        catch (e) { setStatus(`Ошибка печати: ${e.message}`); }
        finally { iframe.remove(); URL.revokeObjectURL(url); }
      }, 500);
    });
  } catch (err) {
    setStatus(`Ошибка печати: ${err.message}`);
  }
});

// Инициализация — пустой список
renderList();
