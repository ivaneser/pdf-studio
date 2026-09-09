// Central in-memory store for documents and their page ranges.
// Emits on every change (add, remove, reorder, setRange) so the UI rebuilds.

export class Store {
  constructor() {
    this.docs = []; // [{ id, name, bytes, pageCount, start, end }]
    this._idSeq = 0;
    this._listeners = new Set();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  emit() {
    for (const fn of this._listeners) fn(this.docs);
  }

  nextId() {
    this._idSeq += 1;
    return `doc_${Date.now().toString(36)}_${this._idSeq}`;
  }

  async add(bytes, name) {
    const id = this.nextId();
    const pageCount = await countPages(bytes); // all pages from the file
    const doc = { id, name, bytes, pageCount, start: 1, end: pageCount };
    this.docs.push(doc);
    this.emit();
    return doc;
  }

  remove(id) {
    this.docs = this.docs.filter((d) => d.id !== id);
    this.emit();
  }

  reorderByIds(ids) {
    const byId = new Map(this.docs.map((d) => [d.id, d]));
    // Validate from the DOM order — this is the merge order.
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    this.docs = ordered;
    this.emit();
  }

  setRange(id, start, end) {
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return;
    // Pages are always whole numbers. Quantize here so the labels and thumbs never
    // show floats — commit() can pass a fractional value when the track is narrow
    // (minStep is only clamped to >= 1, not rounded), e.g. round(2 / 1.5) * 1.5 = 1.5.
    start = Math.max(1, Math.min(doc.pageCount, Math.round(start)));
    end = Math.max(1, Math.min(doc.pageCount, Math.round(end)));
    doc.start = Math.max(1, Math.min(doc.pageCount, start));
    doc.end = Math.max(doc.start, Math.min(doc.pageCount, end));
    this.emit();
  }

  get orderedDocs() {
    return this.docs;
  }
}

export const store = new Store();

// Count pages from a PDF file via pdf-lib.
async function countPages(bytes) {
  try {
    // Namespace import — this bundled lib has no `default` export, so the old
    // `const { default: PDFDocument } = await import('pdf-lib')` threw and fell
    // back to pageCount=1 (only one page rendered). Use a namespace import.
    const mod = await import('pdf-lib');
    const doc = await mod.PDFDocument.load(bytes);
    return doc.getPageCount(); // bundled pdf-lib uses getPageCount()
  } catch (err) {
    // Fallback — one page if the file couldn't be read.
    console.error('Failed to count pages:', err.message);
    return 1;
  }
}
