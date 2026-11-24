export const PDF_MIME_TYPE = 'application/pdf';

export interface PdfFileInfo {
  exists: boolean;
  isDirectory: boolean;
  size?: number;
}

export interface PdfFileSystem {
  getInfoAsync(uri: string): Promise<PdfFileInfo>;
  readAsStringAsync(uri: string, options: { encoding: 'base64' }): Promise<string>;
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync(): Promise<
      | { granted: false }
      | { granted: true; directoryUri: string }
    >;
    createFileAsync(parentUri: string, fileName: string, mimeType: string): Promise<string>;
    writeAsStringAsync(uri: string, contents: string, options: { encoding: 'base64' }): Promise<void>;
    readAsStringAsync(uri: string, options: { encoding: 'base64' }): Promise<string>;
    deleteAsync(uri: string, options: { idempotent: true }): Promise<void>;
  };
}

export interface VerifiedPdfFile {
  uri: string;
  size: number;
  base64: string;
}

export type PdfDeliveryResult =
  | { completed: true; fileName?: string }
  | { completed: false };

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function pdfFileName(title: string) {
  const safeName = title
    .normalize('NFC')
    .replace(/\.pdf$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return `${safeName || 'masjid-chanda-document'}.pdf`;
}

export function pdfByteLengthFromBase64(value: string) {
  const base64 = value.replace(/\s/g, '');
  if (!base64 || base64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error('The generated PDF contains invalid base64 data.');
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function decodeBase64Bytes(value: string, byteCount: number) {
  const base64 = value.replace(/\s/g, '');
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  let accumulator = 0;
  let bitCount = 0;

  for (const character of base64) {
    if (character === '=') break;
    const digit = BASE64_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error('The generated PDF contains invalid base64 data.');
    accumulator = (accumulator << 6) | digit;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[offset++] = (accumulator >> bitCount) & 0xff;
      accumulator &= (1 << bitCount) - 1;
      if (offset === byteCount) break;
    }
  }
  return bytes.subarray(0, offset);
}

export function pdfBytesFromBase64(value: string) {
  const bytes = decodeBase64Bytes(value, pdfByteLengthFromBase64(value));
  assertPdfBytes(bytes);
  return bytes;
}

export function assertPdfBase64Signature(base64: string) {
  if (String.fromCharCode(...decodeBase64Bytes(base64, 5)) !== '%PDF-') {
    throw new Error('The generated file is not a PDF (missing the %PDF- signature).');
  }
}

export function assertPdfBytes(bytes: Uint8Array) {
  if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('The generated file is not a PDF (missing the %PDF- signature).');
  }
}

export async function verifyPdfFile(
  uri: string,
  fileSystem: Pick<PdfFileSystem, 'getInfoAsync' | 'readAsStringAsync'>,
): Promise<VerifiedPdfFile> {
  if (!uri.startsWith('file://')) {
    throw new Error('The PDF generator did not return a readable local file URI.');
  }

  const info = await fileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory || !Number.isFinite(info.size) || (info.size ?? 0) < 5) {
    throw new Error('The generated PDF file is missing or empty.');
  }
  const size = info.size;
  if (size === undefined) {
    throw new Error('The generated PDF file size is unavailable.');
  }

  const base64 = await fileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  assertPdfBase64Signature(base64);
  if (pdfByteLengthFromBase64(base64) !== size) {
    throw new Error('The generated PDF file size does not match its contents.');
  }
  return { uri, size, base64 };
}

export async function savePdfToAndroidDirectory(
  source: VerifiedPdfFile,
  title: string,
  fileSystem: PdfFileSystem,
): Promise<PdfDeliveryResult> {
  const permission = await fileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return { completed: false };

  const fileName = pdfFileName(title);
  const fileStem = fileName.slice(0, -'.pdf'.length);
  const destination = await fileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    fileStem,
    PDF_MIME_TYPE,
  );

  try {
    await fileSystem.StorageAccessFramework.writeAsStringAsync(
      destination,
      source.base64,
      { encoding: 'base64' },
    );
    // Android document providers can report an incomplete size before the stream is read.
    const saved = await fileSystem.StorageAccessFramework.readAsStringAsync(destination, { encoding: 'base64' });
    if (saved.replace(/\s/g, '') !== source.base64.replace(/\s/g, '')) {
      throw new Error('The saved PDF does not match the generated PDF.');
    }
    return { completed: true, fileName };
  } catch (error) {
    try {
      await fileSystem.StorageAccessFramework.deleteAsync(destination, { idempotent: true });
    } catch (cleanupError) {
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`${errorMessage} The incomplete file could not be removed: ${cleanupMessage}`);
    }
    throw error;
  }
}

export interface PdfShareOptions {
  dialogTitle: string;
  mimeType: string;
  UTI?: string;
}

export interface PdfSharing {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(uri: string, options: PdfShareOptions): Promise<void>;
}

export async function shareVerifiedPdf(
  file: VerifiedPdfFile,
  title: string,
  platform: 'android' | 'ios',
  sharing: PdfSharing,
) {
  if (!(await sharing.isAvailableAsync())) {
    throw new Error('Sharing is unavailable in this app runtime. Save the verified PDF to the selected folder instead.');
  }

  await sharing.shareAsync(file.uri, {
    dialogTitle: title,
    mimeType: PDF_MIME_TYPE,
    ...(platform === 'ios' ? { UTI: 'com.adobe.pdf' } : {}),
  });
}

export async function verifyPdfBlob(blob: {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}) {
  if (blob.type.toLowerCase() !== PDF_MIME_TYPE || blob.size < 5) {
    throw new Error('The browser did not generate a non-empty application/pdf file.');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assertPdfBytes(bytes);
  return bytes;
}

export interface PdfDownloadTarget {
  createObjectURL(blob: Blob): string;
  createAnchor(): HTMLAnchorElement;
  appendAnchor(anchor: HTMLAnchorElement): void;
  revokeObjectURL(url: string): void;
  schedule(callback: () => void, delay: number): void;
}

export async function downloadVerifiedPdf(
  blob: Blob,
  title: string,
  target: PdfDownloadTarget,
): Promise<PdfDeliveryResult> {
  await verifyPdfBlob(blob);
  const fileName = pdfFileName(title);
  const url = target.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = target.createAnchor();
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.position = 'fixed';
    anchor.style.left = '-10000px';
    target.appendAnchor(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    target.schedule(() => target.revokeObjectURL(url), 1000);
  }
  return { completed: true, fileName };
}

export interface PrintImage {
  complete: boolean;
  addEventListener(
    event: 'load' | 'error',
    listener: () => void,
    options?: { once?: boolean },
  ): void;
}

export interface ReportPrintDocument {
  readyState: string;
  fonts?: { ready: Promise<unknown> };
  images: ArrayLike<PrintImage>;
  open(): void;
  write(html: string): void;
  close(): void;
  defaultView?: {
    addEventListener(event: 'load', listener: () => void, options?: { once?: boolean }): void;
    requestAnimationFrame?(callback: () => void): number;
  } | null;
}

export interface ReportPrintWindow {
  document: ReportPrintDocument;
  opener: unknown;
  focus(): void;
  print(): void;
}

export async function printReportOnly(
  html: string,
  openWindow: () => ReportPrintWindow | null,
) {
  const printWindow = openWindow();
  if (!printWindow) {
    throw new Error('The report print window was blocked. Allow pop-ups, then choose Print report again.');
  }

  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  if (printWindow.document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      printWindow.document.defaultView?.addEventListener('load', resolve, { once: true });
    });
  }
  await printWindow.document.fonts?.ready;
  await Promise.all(Array.from(printWindow.document.images, (image) => (
    image.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        })
  )));

  const view = printWindow.document.defaultView;
  if (view && view.requestAnimationFrame) {
    const requestFrame = view.requestAnimationFrame.bind(view);
    await new Promise<void>((resolve) => {
      requestFrame(() => requestFrame(resolve));
    });
  } else {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  printWindow.focus();
  printWindow.print();
}
