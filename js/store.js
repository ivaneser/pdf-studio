// Хранилисво загрузленных PDF. Все данные живут в памяти браузера.
// Никаких сетевых запросов к файлам здесь нет.

export class PdfStore {
  constructor() {
    // массив: { id, name, bytes (ArrayBuffer), pageCount, start: number, end: number }
    this.docs = [];
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.docs);
  }

  get orderedDocs() {
    // docs уже в порядке добавления — это и есть порядок слияния
    return this.docs;
  }

  async add(arrayBuffer, name) {
    const mod = await import('pdf-lib');
    const srcDoc = await mod.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const pageCount = srcDoc.getPageCount();
    const doc = {
      id: crypto.randomUUID(),
      name,
      bytes: arrayBuffer,
      pageCount,
      start: 1,
      end: pageCount,
    };
    this.docs.push(doc);
    this.emit();
    return doc;
  }

  remove(id) {
    this.docs = this.docs.filter((d) => d.id !== id);
    this.emit();
  }

  setRange(id, start, end) {
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return;
    doc.start = Math.max(1, Math.min(start, doc.pageCount));
    doc.end = Math.max(1, Math.min(end, doc.pageCount));
    if (doc.start > doc.end) [doc.start, doc.end] = [doc.end, doc.start];
    this.emit();
  }

  // страницы для слияния: 0-based индексы pdf-lib
  mergePageIndices() {
    const indices = [];
    for (const doc of this.docs) {
      for (let p = doc.start - 1; p <= doc.end - 1; p++) indices.push(p);
    }
    return indices;
  }

  get isEmpty() {
    return this.docs.length === 0;
  }
}

export const store = new PdfStore();
