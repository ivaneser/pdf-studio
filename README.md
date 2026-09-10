# PDF Studio

Полностью клиентский PDF-редактор, который работает **внутри одного browser-окна**. Просмотр, объединение нескольких файлов, вырезание страниц и печать — всё выполняется в вашем браузере, файлы никуда не отправляются.

Деплой: [GitHub Pages](https://ivaneser.github.io/pdf-studio/) (автоматически из ветки `main`).

## Задача

Нужно было загрузить JS-код, чтобы он выполнялся **в браузере** и делал манипуляции с PDF: просмотр, объединение, вырезание страниц, печать. Всё живёт внутри browser-окна — без серверной обработки документов.

## Как это устроено

Работа с PDF разделена на две библиотеки (обе в `lib/`, подгружаются локально — **не из CDN**):

| Библиотека | Что делает | Где берётся |
|------------|-----------|-------------|
| **pdf-lib** | Манипуляции: слияние, вырезание страниц, сохранение | `lib/pdf-lib-bundled.mjs` (ES-модуль, через `importmap`) |
| **PDF.js** | Просмотр / превью в `<canvas>`, печать | `lib/pdf.min.js` + `lib/pdf.worker.min.js` (UMD, глобал `window.pdfjsLib`) |

PDF-файлы никогда не покидают браузер; код можно запускать полностью автономно (offline) или с Whitelist'ом внешних ресурсов.

### Архитектура файлов

```
pdf-studio/
├── server.py        # HTTP-сервер на stdlib (:8087), MIME для ES-модулей (.mjs)
├── index.html       # UI: сайдбар + рабочая область, importmap → lib/
├── styles.css       # тёмная тема (Slate / Blue)
├── js/
│   ├── app.js       # связка store/renderer/operations в UI (+ drag&drop)
│   ├── store.js     # PdfStore: данные в памяти, подписки, диапазоны страниц
│   ├── operations.js# mergeDocs / extractSingle / savePdf (pdf-lib)
│   └── renderer.js  # рендер PDF в canvas через PDF.js
└── lib/             # pdf-lib-bundled.mjs + pdf.min.js + worker + .d.ts-типы
```

### Ключевые решения

- **pdf-lib** — операции с PDF. Слияние: `out.copyPages(src, indices)` → решает ошибку "foreign page". Порядок добавления документов = порядок слияния. В этой версии API: `await PDFDocument.load(...)`, `await PDFDocument.create()`, `await src.copyPages(...)` (create и copyPages — async).
- **PDF.js** — превью в `<canvas>`; воркер указан локальным (`./lib/pdf.worker.min.js`).
- **Drag & drop** на `window`, фильтрация файлов по типу/расширению `.pdf`.
- У каждого документа — диапазоны start/end (number-input), можно вырезать часть страниц.
- Печать через скрытый iframe + `window.print()`; скачивание через `<a download>`.

## Запуск локально

```bash
python3 server.py 8087
# откройте http://localhost:8087
```

`server.py` — простой HTTP-сервер на stdlib (`http.server`). Нужен только чтобы отдавать `.mjs`-файлы с MIME `application/javascript` (иначе браузер не загрузит ES-модули). Порт по умолчанию 8087, можно передать свой: `python3 server.py 9000`.

Можно открыть `index.html` через `file://`, но тогда `.mjs`-импорты могут не загрузиться из-за MIME — сервер решает проблему.

## Что умеет

- **Просмотр** — превью первых 3 страниц каждого документа (до 10 при слиянии).
- **Объдинение и скачивание** — «Save» складывает выбранные диапазоны всех документов в один PDF и скачивает его. Порядок = порядок документов в списке (перетаскивание меняет merge-order).
- **Печати итога** — «Print» открывает слияние в iframe и вызывает диалог печати (векторное качество, файл не покидает браузер).
- **Вырезание** (`extractSingle`) — операции с одним документом готовы в `operations.js`, но кнопка в UI пока не подключена.

## Границы ввода номеров страниц

Диапазоны start/end валидируются на стороне клиента:
- **start ∈ [1, end]** (min = 1, max = min(end, totalPages));
- **end ∈ [start, totalPages]** (min = start, max = totalPages).

Вне диапазона поле ввода откатывается к ближайшей допустимой границе для этого поля. Валидация применяется на Enter/blur (`keydown` → `applyValue()` + `input.blur()`, затем `change`). Слайдер и числовые поля синхронизируются через `refreshDocSlider`.

## Технические детали / особенности

- PDF грузятся с `ignoreEncryption: true`; страницы считаются через `pdf-lib` (`getPageCount()`).
- Все данные живут в памяти браузера; никакого localStorage/IndexedDB для файлов.
- **renderer.js**: race с таймаутом 15с — в headless Chrome `page.render().promise` иногда не резолвится, хотя канвас уже отрисован.
- **preview fix** (commit `e4fde45`): при драге слайдеров было ~10 concurrent async-builds превью → перекрывающий рендер/stale canvases (pages shuffled/duplicated). Введён флаг `buildingPreview` + coalescing в `schedulePreview()` (debounce 120ms); SAVE/PRIINT не страдают, баг был только в live-preview.
- **refreshDocSlider fix** (commit `eb2704a`): поля start/end — *соседи* `.page-slider`, а не вложены в него; старый селектор `slider.querySelector('[data-role="start"]')` находил `null` и никогда не обновлял значения полей. Теперь поиск из `.page-range`.

## Известные баги (неисправлены)

- **Drag & drop reorder**: после перетаскивания все карточки исчезают на drop.
- **Preview window** не скролится.
- Слайдер для first/last page (mouse-draggable) ещё не добавлен.

## Деплой

GitHub Pages из `main`, автоматически. `app.js` — ES-модуль через importmap, build-шага нет (`vite`/`rollup`/`webpack`/`esbuild` отсутствуют). Правки действуют после перезагрузки страницы со свежим кэшем; `server.py` шлёт `Cache-Control: no-store` для JS/CSS/HTML.
