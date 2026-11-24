import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { Content, Size, TableCell } from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  PDF_MIME_TYPE,
  downloadVerifiedPdf,
  pdfFileName,
  printReportOnly,
  verifyPdfBlob,
} from './pdf-integrity';
import type { PdfDeliveryResult } from './pdf-integrity';

export type PdfAction = 'save' | 'share' | 'print' | 'download';
export type { PdfDeliveryResult } from './pdf-integrity';

pdfMake.addVirtualFileSystem(pdfFonts);

const colors = {
  green: '#203c32',
  muted: '#52675f',
  border: '#d3ddd6',
  gold: '#c49a45',
  header: '#eef1eb',
};

function textContent(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function tableWidths(columnCount: number): Size[] {
  if (columnCount === 4) return ['*', 'auto', '*', 'auto'];
  if (columnCount === 5) return ['*', 'auto', 'auto', 'auto', '*'];
  if (columnCount >= 6) return Array.from({ length: columnCount }, () => '*');
  return ['*', ...Array.from({ length: Math.max(columnCount - 1, 0) }, () => 'auto' as const)];
}

function toPdfTable(table: HTMLTableElement): Content {
  const rows = Array.from(table.rows);
  const headerRows = table.tHead?.rows.length ?? 0;
  const receipt = Boolean(table.closest('.receipt'));
  const monthly = Boolean(table.closest('.collection-report-page'));
  const metrics = table.classList.contains('report-metrics');
  const ink = monthly ? '#1d347d' : colors.green;
  const columns = Math.max(1, ...rows.map((row) => (
    Array.from(row.cells).reduce((total, cell) => total + cell.colSpan, 0)
  )));
  const body: TableCell[][] = rows.map((row) => {
    const isHeaderRow = row.parentElement?.tagName === 'THEAD';
    const isTotal = row.classList.contains('total');
    const cells: TableCell[] = [];
    for (const cell of Array.from(row.cells)) {
      const span = Math.max(1, cell.colSpan);
      const isHeader = isHeaderRow || cell.tagName === 'TH';
      cells.push({
        text: (metrics ? textContent(cell.innerHTML.replace(/<br\s*\/?\s*>/gi, ' | ').replace(/<[^>]*>/g, ' ')) : textContent(cell.textContent || '')) || ' ',
        alignment: cell.classList.contains('amount') ? 'right' : metrics ? 'center' : 'left',
        fontSize: isTotal && receipt ? 11 : 8,
        bold: isHeader || isTotal,
        color: isTotal && !receipt && !monthly ? '#ffffff' : ink,
        ...(isHeader ? { fillColor: colors.header } : {}),
        ...(metrics ? { fillColor: '#edf4fd' } : {}),
        ...(isTotal ? { fillColor: receipt ? '#d3eee2' : monthly ? '#edf4fd' : colors.green } : {}),
        ...(span > 1 ? { colSpan: span } : {}),
        margin: [0, 1, 0, 1],
      });
      for (let index = 1; index < span; index += 1) cells.push({});
    }
    while (cells.length < columns) cells.push({});
    return cells;
  });

  return {
    table: {
      headerRows,
      dontBreakRows: true,
      keepWithHeaderRows: headerRows ? 1 : 0,
      widths: metrics ? ['*', '*', '*'] : monthly && columns === 5 ? [65, '*', 84, 113, 76] : tableWidths(columns),
      body,
    },
    layout: {
      hLineWidth: (index: number) => index === 0 ? 0 : 0.5,
      vLineWidth: () => monthly ? 0.5 : 0,
      hLineColor: () => colors.border,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 2, 0, 8],
  };
}

function elementContent(element: Element): Content[] {
  const tag = element.tagName.toLowerCase();
  if (element.classList.contains('report-signatures')) {
    const labels = Array.from(element.querySelectorAll('td'), (cell) => textContent(cell.textContent || ''));
    return [{
      columns: labels.map((text) => ({
        width: '*', text, alignment: 'center', bold: true, decoration: 'overline',
      })),
      columnGap: 14,
      margin: [0, 14, 0, 0],
    }];
  }
  if (tag === 'table') return [toPdfTable(element as HTMLTableElement)];
  if (tag === 'h2') {
    const text = textContent(element.textContent || '');
    return text ? [{
      text, bold: true, fontSize: 10,
      color: element.closest('.collection-report-page') ? '#1d347d' : colors.green,
      margin: [0, 9, 0, 3],
      ...(element.classList.contains('annual-households-heading') ? { pageBreak: 'before' } : {}),
    }] : [];
  }
  if (tag === 'p') {
    const text = textContent(element.textContent || '');
    if (!text) return [];
    const monthlyNote = element.classList.contains('report-note');
    const balanceNote = element.classList.contains('statement-balance-note');
    if (monthlyNote || balanceNote || element.classList.contains('report-status')) {
      return [{ table: { widths: ['*'], body: [[{
        text, fillColor: monthlyNote ? '#fff8e8' : balanceNote ? '#f4f7fa' : '#edfbf3', margin: [8, 6, 8, 6],
      }]] }, layout: 'noBorders', margin: [0, 4, 0, 5] }];
    }
    if (element.classList.contains('receipt-blessing')) {
      return [{ table: { widths: ['*'], body: [[{
        text, italics: true, fillColor: '#f4eedb', margin: [8, 6, 8, 6],
      }]] }, layout: 'noBorders', margin: [0, 6, 0, 12] }];
    }
    if (element.classList.contains('receipt-signature')) {
      return [{ text, alignment: 'right', color: colors.muted, margin: [0, 20, 0, 0] }];
    }
    const isNote = element.classList.contains('method-note') || element.classList.contains('note');
    return [{
      text,
      fontSize: isNote ? 7.5 : 8,
      color: isNote ? colors.muted : colors.green,
      margin: [0, 2, 0, 7],
    }];
  }
  return Array.from(element.children).flatMap(elementContent);
}

export function buildPdfDefinition(html: string): TDocumentDefinitions {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const body = parsed.body;
  const header = body.querySelector(':scope > header');
  const title = textContent(header?.querySelector('h1')?.textContent || '');
  if (!title) throw new Error('The PDF document has no title.');

  const brandElement = header?.querySelector('.brand');
  const greeting = textContent(brandElement?.querySelector('.receipt-greeting')?.textContent || '');
  const brand = textContent(brandElement?.firstChild?.textContent || 'MASJID E SHAMEEM');
  const subtitle = textContent(header?.querySelector('.subtitle')?.textContent || '');
  const generated = textContent(body.querySelector(':scope > footer')?.textContent || '');
  const monthly = body.classList.contains('collection-report-page');
  const monthlyGreeting = textContent(header?.querySelector('.report-greeting')?.lastChild?.textContent || '');
  const content: Content[] = monthly ? [
    { table: { widths: ['*'], body: [[{
      text: monthlyGreeting, alignment: 'center', italics: true, color: '#10542d', fillColor: '#edfbf3', margin: [0, 6, 0, 6],
    }]] }, layout: 'noBorders', margin: [0, 0, 0, 5] },
    { table: { widths: ['*', 'auto'], body: [[
      { text: brand, bold: true, fontSize: 13, color: '#ffffff', fillColor: '#1d347d', margin: [6, 6, 0, 6] },
      { text: title.toUpperCase(), bold: true, fontSize: 9, color: '#ffffff', fillColor: '#1d347d', margin: [0, 8, 6, 6] },
    ]] }, layout: 'noBorders' },
    { text: subtitle, color: '#1d347d', margin: [6, 4, 0, 6] },
  ] : greeting ? [
    { table: { widths: ['*'], body: [
      [{ text: brand, alignment: 'center', bold: true, fontSize: 15, color: '#ffffff', fillColor: '#19342a', margin: [0, 12, 0, 3] }],
      [{ text: greeting, alignment: 'center', italics: true, color: '#ead58f', fillColor: '#19342a', margin: [0, 0, 0, 12] }],
    ] }, layout: 'noBorders' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 521, y2: 0, lineWidth: 3, lineColor: colors.gold }] },
    { text: title, alignment: 'center', fontSize: 25, color: colors.green, margin: [0, 18, 0, 4] },
    { text: subtitle, alignment: 'center', fontSize: 11, color: colors.muted, margin: [0, 0, 0, 12] },
  ] : [
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 521, y2: 0, lineWidth: 3, lineColor: colors.green }], margin: [0, 0, 0, 10] },
    { text: brand, fontSize: 9, bold: true, characterSpacing: 1, color: colors.green, margin: [0, 0, 0, 4] },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 12, y2: 0, lineWidth: 2, lineColor: colors.gold }], margin: [0, 0, 0, 7] },
    { text: title, fontSize: 19, bold: true, color: colors.green, margin: [0, 0, 0, 3] },
    { text: subtitle, fontSize: 9, color: colors.muted, margin: [0, 0, 0, 10] },
  ];

  for (const element of Array.from(body.children)) {
    if (element === header || element.tagName.toLowerCase() === 'footer') continue;
    content.push(...elementContent(element));
  }

  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [37, 38, 37, 46],
    content,
    defaultStyle: {
      font: 'Roboto',
      fontSize: 8,
      color: colors.green,
      lineHeight: 1.15,
    },
    footer: (pageNumber, pageCount) => ({
      columns: [
        { text: generated, width: '*', fontSize: 7, color: colors.muted },
        { text: `Page ${pageNumber} of ${pageCount}`, alignment: 'right', fontSize: 7, color: colors.muted },
      ],
      margin: [37, 0, 37, 16],
    }),
  };
}

async function generatePdfBlob(html: string) {
  const pdf = pdfMake.createPdf(buildPdfDefinition(html));
  const blob = await pdf.getBlob();
  await verifyPdfBlob(blob);
  return blob;
}

async function downloadPdf(html: string, title: string) {
  if (!document.body) {
    throw new Error('The browser is not ready to download the report yet.');
  }
  const blob = await generatePdfBlob(html);
  return downloadVerifiedPdf(blob, title, {
    createObjectURL: (file) => URL.createObjectURL(file),
    createAnchor: () => document.createElement('a'),
    appendAnchor: (anchor) => { document.body?.appendChild(anchor); },
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    schedule: (callback, delay) => { window.setTimeout(callback, delay); },
  });
}

export async function deliverPdf(
  html: string,
  title: string,
  action: PdfAction,
): Promise<PdfDeliveryResult> {
  if (action === 'print') {
    await printReportOnly(html, () => window.open('', '_blank'));
    return { completed: true };
  }
  if (action === 'download' || action === 'save') {
    return downloadPdf(html, title);
  }
  if (action === 'share') {
    throw new Error('Sharing local PDF files is not supported on Web. Use Download PDF or Print report.');
  }
  throw new Error('Unsupported PDF action.');
}

export { PDF_MIME_TYPE, pdfFileName };
