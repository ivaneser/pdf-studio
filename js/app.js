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
    const count = doc.pageCount; // всё превью — все страницы
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
    const count = doc.numPages; // всё превью — все страницы
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
    li.dataset.id = doc.id; // ОБЯЗАТЕЛЬНО: drop-обработчик читает li.dataset.id,
    // без этого reorderByIds получает [undefined,...] → docs ⟶ [] → карточки исчезают
    const pctStart = Math.max(0, Math.min(100, ((doc.start - 1) / Math.max(1, doc.pageCount - 1)) * 100));
    const pctEnd = Math.max(pctStart, Math.min(100, ((doc.end - 1) / Math.max(1, doc.pageCount - 1)) * 100));
    li.innerHTML = `
      <div class="name-row">
        <button class="btn-del" data-id="${doc.id}" title="Удалить">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
        <div class="name" draggable="true">${doc.name}</div>
      </div>
      <div class="page-range">
        <span class="pr-label pr-start" data-role="start">${doc.start}</span>
        <div class="page-slider" data-id="${doc.id}">
          <div class="ps-track">
            <div class="ps-fill" style="left:${pctStart}%;width:${pctEnd - pctStart}%"></div>
            <div class="ps-thumb ps-start" data-field="start" style="left:${pctStart}%"></div>
            <div class="ps-thumb ps-end" data-field="end" style="left:${pctEnd}%"></div>
          </div>
        </div>
        <span class="pr-label pr-end" data-role="end">${doc.end}</span>
      </div>
    `;
    docList.appendChild(li);
    // Перетаскиваем ТОЛЬКО за имя документа — не за всю карточку.
    const nameEl = li.querySelector('.name');
    nameEl._dragId = doc.id;
  });

  // Свой обработчик drag для слайдера: thumb двигается мышью, без конфликта с DnD карточки.
  docList.querySelectorAll('.page-slider').forEach((slider) => bindSlider(slider));
}

// Build preview once, then debounce further calls by 120ms. store.emit() fires on
// every thumb mousemove during a drag; buildPreview() is an async PDF merge that
// wipes canvasArea and re-renders pages each time — firing it per pixel spawns
// dozens of concurrent merges clobbering the same canvas, which looks like pages
// multiplying instead of trimming. Coalesce them into one rebuild after settling.
let previewTimer = null;
let pendingPreview = false;
// Пока перетаскиваем слайдер — emit() НЕ запускаем перерисовку списка и превью.
// liveUpdate сам обновляет только этот слайдер, а на mouseup делаем один полный rebuild.
let sliderDragging = false;
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  const run = () => {
    previewTimer = null;
    if (!pendingPreview) return buildPreview();
    pendingPreview = false;
    run();
  };
  previewTimer = setTimeout(run, 120);
}

store.subscribe(() => {
  // Во время drag слайдера НЕ перерисовываем список и превью — liveUpdate сам
  // точечно обновляет только этот слайдер, чтобы thumb не «прыгал» от rebuild.
  if (sliderDragging) return;
  renderList();
  if (store.orderedDocs.length > 0) schedulePreview();
});

// Drag & drop для изменения порядка карточек (порядок = порядок слияния).
// Перемещаем DOM-элементы напрямую во время dragover — плавно «приливают».
// В store фиксируем итоговый порядок только на drop.
let dragId = null;
docList.addEventListener('dragstart', (e) => {
  // Перетаскиваем ТОЛЬКО за имя документа, не за всю карточку и не за слайдер.
  const nameEl = e.target.closest('.name');
  if (!nameEl || !nameEl._dragId) return;
  dragId = nameEl._dragId;
  const li = nameEl.closest('.doc-item');
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';

  // Кастомный предпросмотр перетаскивания — показывает ВЦЕЛОК карточку, а не только
  // текст имени: клонируем .doc-item, прячем за экран и передаём как drag-image.
  const ghost = li.cloneNode(true);
  Object.assign(ghost.style, {
    position: 'absolute', top: '-9999px', left: '-9999px',
    opacity: '0.92', transform: 'none', pointerEvents: 'none',
    zIndex: '-1',
  });
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 40, 20);
  // Убираем клон после того, как браузер скопировал его в drag-картинку.
  requestAnimationFrame(() => ghost.remove());
});
docList.addEventListener('dragend', (e) => {
  const li = e.target.closest('.doc-item');
  if (li) li.classList.remove('dragging');
  dragId = null;
});
docList.addEventListener('dragover', (e) => {
  if (!dragId) return;
  e.preventDefault(); // разрешаем drop
  const target = e.target.closest('.doc-item');
  if (!target || target.dataset.id === dragId) return;

  const rect = target.getBoundingClientRect();
  const afterTarget = (e.clientY - rect.top) > rect.height / 2;
  const draggedEl = docList.querySelector(`.doc-item[data-id="${dragId}"]`);
  if (!draggedEl) return;

  // Вставляем перетаскиваемый элемент относительно ЦЕЛЕВОГО элемента:
  // перед ним (верхняя половина) или за ним (нижняя половина).
  // insertAdjacentElement всегда ставит dragged относительно fixed target,
  // независимо от того, где dragged сейчас находится.
  if (afterTarget) {
    target.insertAdjacentElement('afterend', draggedEl);
  } else {
    target.insertAdjacentElement('beforebegin', draggedEl);
  }
});
docList.addEventListener('drop', () => {
  // Фиксируем новый порядок карточек из DOM в store.
  const ids = [...docList.querySelectorAll('.doc-item')].map((li) => li.dataset.id);
  if (ids.length) store.reorderByIds(ids);
  dragId = null;
});

// Мобильный drag для изменения порядка карточек: mouse/drag-and-drop работает
// только на ПК, поэтому здесь — отдельная система на touch-событиях. Держим палец
// на имени >300ms (long-press) → начинаем перетаскивать → двигаем пальцем, плавно
// «приливая» к соседним карточкам → отпускаем → фиксируем порядок в store.
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
    // Блокируем прокрутку/выделение пока тащим карточку.
    document.body.style.userSelect = 'none';
    document.body.style.overflow = 'hidden';
  }, LONG_PRESS_MS);
}, { passive: true });

docList.addEventListener('touchmove', (e) => {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  if (!touchDragEl) return;
  touchMoved = true;
  e.preventDefault(); // не даём скроллить страницу пальцем

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
    // Фиксируем порядок только если реально перетаскивали — иначе не ломаем tap.
    if (touchMoved) {
      const ids = [...docList.querySelectorAll('.doc-item')].map((li) => li.dataset.id);
      if (ids.length) store.reorderByIds(ids);
    }
  }
  touchDragId = null;
  touchDragEl = null;
  touchMoved = false;
});

// Свой обработчик drag для слайдера — thumb двигается мышью, без конфликта с DnD карточки.
// Позиции дискретные: thumb привязан к целым номерам страниц (1..pageCount), а не к пикселям.
function bindSlider(slider) {
  const doc = store.docs.find((d) => d.id === slider.dataset.id);
  if (!doc) return;
  const track = slider.querySelector('.ps-track');
  let field = null;
  // Поле thumb, который взяли последним. При слиянии двух thumbs показываем/оставляем
  // активным ТОЛЬКО его — иначе на мобильных второй уже не достать пальцем.
  let lastField = null;

  // Обновить ТОЛЬКО этот слайдер: заливку, позиции thumb и числовые подписи.
  // НЕ перерисовываем весь список (renderList) — иначе каждый mousemove во время
  // drag вызывает full rebuild карточек, из-за чего ползунок «прыгает» к краю.
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

    // Два thumb «прилипают» друг к другу, когда их страницы совпадают. Тогда они
    // визуально перекрываются и нижний уже не попасть пальцем/курсором. Раньше мы их
    // сдвигали по вертикали — это неудобно на мобильных. Теперь при слиянии показываем
    // и оставляем активным ТОЛЬКО тот thumb, который взяли последним (lastField): он
    // под пальцем, а второй прячем (opacity: 0), чтобы его случайно не тащить. Как
    // страницы снова расходятся — оба возвращаются в дефолтное положение.
    if (startThumb && endThumb) {
      const overlap = Math.abs(pctStart - pctEnd) < 0.5;
      if (overlap) {
        const active = lastField === 'end' ? endThumb : startThumb;
        const other = active === startThumb ? endThumb : startThumb;
        active.style.opacity = '1';
        active.style.top = '-3px';
        // Второй thumb остаётся на месте (left не трогаем), но прячем — он неактивен.
        other.style.opacity = '0';
      } else {
        startThumb.style.opacity = '1';
        endThumb.style.opacity = '1';
        startThumb.style.top = '-3px';
        endThumb.style.top = '-3px';
      }
    }

    // Числовые подписи: № первой страницы до слайдера, № последней — после.
    const range = slider.closest('.page-range');
    if (range) {
      const startLabel = range.querySelector('[data-role="start"]');
      const endLabel = range.querySelector('[data-role="end"]');
      if (startLabel) startLabel.textContent = start;
      if (endLabel) endLabel.textContent = end;
    }
  };

  // процент → целая страница (1..pageCount). Math.round даёт дискретные шаги.
  const pageFromPct = (pct) => {
    return Math.max(1, Math.min(doc.pageCount, Math.round((pct / 100) * (doc.pageCount - 1)) + 1));
  };

  const pctFromClientX = (x) => {
    const rect = track.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100));
  };

  // Точность квантования: слайдер длиной L px даёт шаг ~L/pageCount.
  // Ограничим минимальный шаг (0.5 страницы), чтобы «мерцание» у краёв не дрожало thumb.
  const minStep = Math.max(1, doc.pageCount / track.getBoundingClientRect().width);

  const commit = (pct) => {
    let page = pageFromPct(pct);
    // Квантуем к шагу — убираем дробные «прыжки» между целыми страницами.
    if (field === 'start') {
      const quantized = Math.max(1, Math.min(doc.end, Math.round(page / minStep) * minStep));
      store.setRange(doc.id, quantized, doc.end);
    } else {
      const quantized = Math.min(doc.pageCount, Math.max(doc.start, Math.round(page / minStep) * minStep));
      store.setRange(doc.id, doc.start, quantized);
    }
    // Живое обновление этого слайдера — без перерисовки всего списка.
    const d = store.docs.find((x) => x.id === slider.dataset.id);
    if (d) liveUpdate(d.start, d.end);
  };

  const onDown = (e) => {
    const thumb = e.target.closest('.ps-thumb');
    if (!thumb || !thumb.dataset.field) return;
    field = thumb.dataset.field;
    // Запоминаем, какой именно thumb только что взяли — чтобы при слиянии показывать/
    // оставлять активным ТОЛЬКО его (второй на мобильных уже не достать пальцем).
    lastField = field;
    sliderDragging = true;

    // Собственный drag — не даём событиям уйти на карточку/DnD. Поддерживаем и мышь,
    // и тач: на мобильных mousemove не срабатывает, поэтому там ловим touchmove.
    if (e.cancelable) e.preventDefault();
    document.body.style.userSelect = 'none';

    // X-координата для любого типа события (мышь или пальцем).
    const getX = (ev) => {
      if (ev.touches && ev.touches.length > 0) return ev.touches[0].clientX;
      return ev.clientX;
    };

    const move = (ev) => {
      commit(pctFromClientX(getX(ev)));
      // Блокируем скролл страницы пальцем пока тянем слайдер.
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
      // Один чистый rebuild после окончания drag — синхронизируем список и превью.
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
  // На мобильных mousemove не срабатывает — ловим touchstart. НЕ passive, чтобы
  // можно было preventDefault и заблокировать скролл страницы при начале drag'а.
  slider.addEventListener('touchstart', onDown);
}

docList.addEventListener('click', (e) => {
  const delBtn = e.target.closest('.btn-del');
  if (delBtn) {
    store.remove(delBtn.dataset.id);
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
