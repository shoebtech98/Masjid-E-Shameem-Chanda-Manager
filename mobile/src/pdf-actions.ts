import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  PDF_MIME_TYPE,
  PdfDeliveryResult,
  PdfFileSystem,
  PdfSharing,
  pdfFileName,
  savePdfToAndroidDirectory,
  shareVerifiedPdf,
  verifyPdfFile,
  assertPdfBase64Signature,
  pdfByteLengthFromBase64,
  pdfBytesFromBase64,
} from './pdf-integrity';

export type PdfAction = 'save' | 'share' | 'print' | 'download';
export type { PdfDeliveryResult } from './pdf-integrity';

const fileSystem = FileSystem as PdfFileSystem;
const sharing = Sharing as PdfSharing;
const androidFileSystem: PdfFileSystem = {
  ...fileSystem,
  StorageAccessFramework: {
    ...fileSystem.StorageAccessFramework,
    async writeAsStringAsync(uri, contents, options) {
      await new File(uri).write(contents, options);
    },
    async readAsStringAsync(uri) {
      return new File(uri).base64();
    },
  },
};
const a4 = { width: 595, height: 842 };
let androidActionInProgress = false;

async function createVerifiedPdf(html: string) {
  const file = await Print.printToFileAsync({ html, ...a4 });
  return verifyPdfFile(file.uri, fileSystem);
}

async function nameCachedPdf(file: Awaited<ReturnType<typeof createVerifiedPdf>>, title: string) {
  const folder = `${file.uri}-named/`;
  const uri = folder + encodeURIComponent(pdfFileName(title));
  await FileSystem.makeDirectoryAsync(folder);
  try {
    await FileSystem.moveAsync({ from: file.uri, to: uri });
    return { ...file, uri };
  } catch (cause) {
    await FileSystem.deleteAsync(folder, { idempotent: true }).catch(() => {});
    throw cause;
  }
}

async function prepareAndroidAttachment(source: Awaited<ReturnType<typeof createVerifiedPdf>>, title: string) {
  // Expo Print can return a path outside the project's writable cache in Expo Go.
  const folder = new Directory(Paths.cache, 'pdf-exports', Paths.basename(source.uri, '.pdf'));
  await folder.create({ intermediates: true });
  const attachment = new File(folder, pdfFileName(title));
  try {
    await attachment.write(pdfBytesFromBase64(source.base64));
    const copiedBytes = await attachment.base64();
    if (copiedBytes.replace(/\s/g, '') !== source.base64.replace(/\s/g, '')) {
      throw new Error('The PDF attachment in the app cache does not match the generated PDF.');
    }
    return { ...source, uri: attachment.uri };
  } catch (cause) {
    await FileSystem.deleteAsync(folder.uri, { idempotent: true }).catch(() => {});
    throw cause;
  }
}

async function deliverAndroidPdf(html: string, title: string, action: 'save' | 'share' | 'print') {
  if (androidActionInProgress) throw new Error('A PDF action is already in progress.');
  androidActionInProgress = true;
  try {
    if (action === 'print') {
      // Use the WebView print adapter so Android can lay out and paginate for the selected printer.
      const options: Print.FilePrintOptions = { html, ...a4, textZoom: 100 };
      await Print.printAsync(options);
      return { completed: true } as const;
    }
    const rendered = await Print.printToFileAsync({ html, ...a4, textZoom: 100, base64: true });
    const base64 = rendered.base64;
    try {
      if (!base64) throw new Error('Android did not return the generated PDF. Try opening Print PDF instead.');
      assertPdfBase64Signature(base64);
      const file = { uri: rendered.uri, size: pdfByteLengthFromBase64(base64), base64 };
      if (action === 'save') return await savePdfToAndroidDirectory(file, title, androidFileSystem);

      const namedFile = await prepareAndroidAttachment(file, title);
      // The recipient may read the cache file after the Android chooser closes.
      await shareVerifiedPdf(namedFile, title, 'android', sharing);
      return { completed: true } as const;
    } finally {
      await FileSystem.deleteAsync(rendered.uri, { idempotent: true }).catch(() => {});
    }
  } finally {
    androidActionInProgress = false;
  }
}

export async function deliverPdf(
  html: string,
  title: string,
  action: PdfAction,
): Promise<PdfDeliveryResult> {
  if (Platform.OS === 'web') {
    throw new Error('Web PDF actions use the dedicated report document implementation.');
  }
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('PDF delivery is not supported on this platform.');
  }
  if (action === 'download') {
    throw new Error('Browser PDF downloads are only available on Expo Web.');
  }
  if (Platform.OS === 'android') return deliverAndroidPdf(html, title, action);

  const file = await nameCachedPdf(await createVerifiedPdf(html), title);
  if (action === 'print') {
    await Print.printAsync({ uri: file.uri });
    return { completed: true };
  }
  await shareVerifiedPdf(file, title, Platform.OS, sharing);
  return { completed: true };
}

export { PDF_MIME_TYPE, pdfFileName };
