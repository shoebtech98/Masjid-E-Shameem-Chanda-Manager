import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/pdf-integrity.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const integrity = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const pdfBytes = Buffer.from('%PDF-1.7\nStaging report fixture', 'ascii');
const pdfBase64 = pdfBytes.toString('base64');
const fileName = integrity.pdfFileName('Masjid E Shameem-Payment Received- November-2026');
assert.equal(fileName, 'Masjid E Shameem-Payment Received- November-2026.pdf');
assert.equal(integrity.pdfByteLengthFromBase64(pdfBase64), pdfBytes.length);
integrity.assertPdfBase64Signature(pdfBase64);
assert.deepEqual(Buffer.from(integrity.pdfBytesFromBase64(pdfBase64)), pdfBytes);
assert.throws(() => integrity.pdfBytesFromBase64('bm90IGEgcGRm'), /not a PDF/);
console.log('  ✓ PDF filenames are safe and retain the .pdf extension; source bytes have a PDF signature');

const storedFiles = new Map([['file:///cache/report.pdf', pdfBytes]]);
const fsMock = {
  async getInfoAsync(uri) {
    const bytes = storedFiles.get(uri);
    return bytes
      ? { exists: true, isDirectory: false, size: bytes.length }
      : { exists: false, isDirectory: false };
  },
  async readAsStringAsync(uri) {
    const bytes = storedFiles.get(uri);
    if (!bytes) throw new Error('File not found');
    return bytes.toString('base64');
  },
  StorageAccessFramework: {
    async requestDirectoryPermissionsAsync() {
      return { granted: true, directoryUri: 'content://downloads' };
    },
    async createFileAsync(parentUri, name, mimeType) {
      assert.equal(parentUri, 'content://downloads');
      assert.equal(name, 'Masjid E Shameem-Payment Received- November-2026');
      assert.equal(mimeType, 'application/pdf');
      return 'content://downloads/Masjid E Shameem-Payment Received- November-2026.pdf';
    },
    async writeAsStringAsync(uri, contents, options) {
      assert.equal(options.encoding, 'base64');
      storedFiles.set(uri, Buffer.from(contents, 'base64'));
    },
    async readAsStringAsync(uri) {
      const bytes = storedFiles.get(uri);
      if (!bytes) throw new Error('File not found');
      return bytes.toString('base64');
    },
    async deleteAsync(uri) {
      storedFiles.delete(uri);
    },
  },
};

const verified = await integrity.verifyPdfFile('file:///cache/report.pdf', fsMock);
assert.equal(verified.size, pdfBytes.length);
const saveResult = await integrity.savePdfToAndroidDirectory(verified, 'Masjid E Shameem-Payment Received- November-2026', fsMock);
assert.deepEqual(saveResult, { completed: true, fileName: 'Masjid E Shameem-Payment Received- November-2026.pdf' });
assert.deepEqual(storedFiles.get('content://downloads/Masjid E Shameem-Payment Received- November-2026.pdf'), pdfBytes);
console.log('  ✓ Android SAF receives Base64-decoded PDF bytes with the correct MIME type and verifies the saved file');

const corruptedFs = {
  ...fsMock,
  StorageAccessFramework: {
    ...fsMock.StorageAccessFramework,
    async readAsStringAsync() {
      const corrupted = Buffer.from(pdfBytes);
      corrupted[corrupted.length - 1] ^= 1;
      return corrupted.toString('base64');
    },
  },
};
await assert.rejects(
  integrity.savePdfToAndroidDirectory(verified, 'Masjid E Shameem-Payment Received- November-2026', corruptedFs),
  /does not match/,
);
assert.equal(storedFiles.has('content://downloads/Masjid E Shameem-Payment Received- November-2026.pdf'), false);

const cancelledFs = {
  ...fsMock,
  StorageAccessFramework: {
    ...fsMock.StorageAccessFramework,
    async requestDirectoryPermissionsAsync() {
      return { granted: false };
    },
  },
};
assert.deepEqual(
  await integrity.savePdfToAndroidDirectory(verified, 'Report', cancelledFs),
  { completed: false },
);
await assert.rejects(
  integrity.verifyPdfFile('https://example.test/report.pdf', fsMock),
  /local file URI/,
);
console.log('  ✓ Save cancellation is not reported as success, and remote/non-local file URIs are rejected');

let sharedUri;
let shareOptions;
await integrity.shareVerifiedPdf(verified, 'Monthly report', 'ios', {
  async isAvailableAsync() { return true; },
  async shareAsync(uri, options) {
    sharedUri = uri;
    shareOptions = options;
  },
});
assert.equal(sharedUri, verified.uri);
assert.deepEqual(shareOptions, {
  dialogTitle: 'Monthly report',
  mimeType: 'application/pdf',
  UTI: 'com.adobe.pdf',
});
await assert.rejects(
  integrity.shareVerifiedPdf(verified, 'Monthly report', 'android', {
    async isAvailableAsync() { return false; },
    async shareAsync() { assert.fail('Must not share when unavailable'); },
  }),
  /Sharing is unavailable/,
);
console.log('  ✓ Sharing uses the verified local file, application/pdf and the iOS PDF UTI, and checks availability');

await integrity.verifyPdfBlob({
  type: 'application/pdf',
  size: pdfBytes.length,
  async arrayBuffer() {
    return pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
  },
});
await assert.rejects(
  integrity.verifyPdfBlob({
    type: 'application/pdf',
    size: 12,
    async arrayBuffer() { return Buffer.from('<html>oops').buffer; },
  }),
  /%PDF- signature/,
);
await assert.rejects(
  integrity.verifyPdfBlob({
    type: 'text/html',
    size: pdfBytes.length,
    async arrayBuffer() { return pdfBytes.buffer; },
  }),
  /application\/pdf/,
);
console.log('  ✓ Browser PDF blobs require application/pdf MIME and the %PDF- byte signature');

const downloadState = {};
const anchor = {
  href: '',
  download: '',
  style: {},
  click() { downloadState.clicked = true; },
  remove() { downloadState.removed = true; },
};
const downloadResult = await integrity.downloadVerifiedPdf({
  type: 'application/pdf',
  size: pdfBytes.length,
  async arrayBuffer() {
    return pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
  },
}, 'Masjid E Shameem-November-2026-Monthly report', {
  createObjectURL(blob) {
    assert.equal(blob.type, 'application/pdf');
    return 'blob:verified-report';
  },
  createAnchor() { return anchor; },
  appendAnchor(value) { assert.equal(value, anchor); downloadState.appended = true; },
  revokeObjectURL(url) { downloadState.revokedUrl = url; },
  schedule(callback, delay) {
    assert.equal(delay, 1000);
    callback();
  },
});
assert.deepEqual(downloadResult, { completed: true, fileName: 'Masjid E Shameem-November-2026-Monthly report.pdf' });
assert.deepEqual(downloadState, {
  clicked: true,
  removed: true,
  appended: true,
  revokedUrl: 'blob:verified-report',
});
assert.equal(anchor.download, 'Masjid E Shameem-November-2026-Monthly report.pdf');
await assert.rejects(
  integrity.downloadVerifiedPdf({
    type: 'application/pdf',
    size: 12,
    async arrayBuffer() { return Buffer.from('not a pdf').buffer; },
  }, 'Invalid report', {
    createObjectURL() { assert.fail('Invalid PDF must not be downloaded'); },
  }),
  /%PDF- signature/,
);
console.log('  ✓ Web download triggers only a verified PDF blob with a safe .pdf filename');

const reportHtml = '<!doctype html><html><head><style>@page { size: A4; }</style></head><body><h1>Monthly report</h1><table><thead><tr><th>Amount</th></tr></thead><tbody><tr><td>₹600.00</td></tr></tbody></table></body></html>';
let writtenHtml;
let focused = false;
let printed = false;
const printWindow = {
  opener: {},
  focus() { focused = true; },
  print() { printed = true; },
  document: {
    readyState: 'complete',
    images: [],
    fonts: { ready: Promise.resolve() },
    defaultView: {
      requestAnimationFrame(callback) {
        callback();
        return 1;
      },
    },
    open() {},
    write(html) { writtenHtml = html; },
    close() {},
  },
};
await integrity.printReportOnly(reportHtml, () => printWindow);
assert.equal(writtenHtml, reportHtml);
assert.equal(printWindow.opener, null);
assert.equal(focused, true);
assert.equal(printed, true);
await assert.rejects(
  integrity.printReportOnly(reportHtml, () => null),
  /print window was blocked/,
);
console.log('  ✓ Web printing writes only the complete report document to its separate print window');
