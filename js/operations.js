// PDF manipulation on the client via pdf-lib.
// All operations run in browser memory — files are never sent anywhere.
//
// IMPORTANT for this version of the API:
//   - await PDFDocument.load(...)
//   - const out = await PDFDocument.create()          <- create is async!
//   - pages = await src.copyPages(src, indices)       <- copy pages in
//   - for (const p of pages) out.addPage(p)

import * as pdfLib from 'pdf-lib';

export async function mergeDocs(docs) {
  const out = await pdfLib.PDFDocument.create();
  // Copy pages directly into the target doc to avoid "foreign page" error
  for (const doc of docs) {
    const src = await pdfLib.PDFDocument.load(doc.bytes, { ignoreEncryption: true });
    const indices = [];
    for (let p = doc.start - 1; p <= doc.end - 1; p++) indices.push(p);
    const pages = await out.copyPages(src, indices);
    for (const page of pages) out.addPage(page);
  }
  return out.save();
}

// Вырезание: из одного документа берём выбранные страницы.
export async function extractSingle(doc, indices) {
  const src = await pdfLib.PDFDocument.load(doc.bytes, { ignoreEncryption: true });
  const out = await pdfLib.PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  for (const page of pages) out.addPage(page);
  return out.save();
}

export async function savePdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
