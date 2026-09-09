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
    // Limit within available pages and don't overflow the range.
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
    const { default: PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    return doc.getPageCount(); // bundled pdf-lib uses getPageCount(), not getNumberOfPages()
  } catch (err) {
    // Fallback — one page if the file couldn't be read.
    console.error('Failed to count pages:', err.message);
    return 1;
  }
}
