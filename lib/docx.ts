// Word (.docx) export. html-to-docx gives every picture the same drawing id (id="1"), which
// Microsoft Word rejects ("Word experienced an error trying to open the file") although other
// programs open it. This wrapper builds the file and then gives each picture a unique id.
import HTMLtoDOCX from 'html-to-docx';
// jszip is html-to-docx's own zip library (installed with it).
import JSZip from 'jszip';

export async function htmlToDocx(html: string, options: Record<string, any> = {}): Promise<Buffer> {
  // html-to-docx writes w:header="undefined" and w:gutter="undefined" when only some margins are given,
  // and Word refuses the file. Always pass every margin.
  const margins = { top: 1440, right: 1800, bottom: 1440, left: 1800, header: 720, footer: 720, gutter: 0, ...(options.margins || {}) };
  const raw: any = await (HTMLtoDOCX as any)(html, null, { ...options, margins });
  return fixDrawingIds(Buffer.from(raw));
}

export async function fixDrawingIds(docx: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  const part = zip.file('word/document.xml');
  if (!part) return docx;
  const xml = await part.async('string');
  let n = 0;
  // Each <wp:docPr> and its <pic:cNvPr> get the same new number; numbers are unique per document.
  const fixed = xml.replace(/<wp:docPr id="\d+"([\s\S]*?)<pic:cNvPr id="\d+"/g, (_m, between) => {
    n += 1;
    return `<wp:docPr id="${n}"${between}<pic:cNvPr id="${n}"`;
  });
  const out = fixParaPropsOrder(fixBorderOrder(fixTablePropsOrder(moveSectPrToEnd(fixed))))
    .replace(/\s[\w:]+="undefined"/g, '')
    // A table with <thead> and <tbody> gets a second grid after the header row; only one is allowed.
    .replace(/(<\/w:tr>\s*)<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g, '$1');
  if (out === xml) return docx;
  zip.file('word/document.xml', out);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Word requires the page settings (<w:sectPr>) to be the LAST child of <w:body>; html-to-docx writes
// it first, which Word refuses to open.
export function moveSectPrToEnd(xml: string): string {
  const m = xml.match(/<w:body>(\s*)(<w:sectPr>[\s\S]*?<\/w:sectPr>)/);
  if (!m) return xml;
  return xml.replace(m[0], '<w:body>' + m[1]).replace('</w:body>', `${m[2]}</w:body>`);
}

// Word also checks the order of table settings; html-to-docx writes them out of schema order.
const TBL_ORDER = ['tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize', 'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook'];
export function fixTablePropsOrder(xml: string): string {
  return xml.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g, (_m, inner) => {
    const parts: { name: string; xml: string }[] = [];
    const re = /<w:(\w+)\b[^>]*?(?:\/>|>[\s\S]*?<\/w:\1>)/g;
    let t;
    while ((t = re.exec(inner))) parts.push({ name: t[1], xml: t[0] });
    const rank = (n: string) => (TBL_ORDER.indexOf(n) < 0 ? 99 : TBL_ORDER.indexOf(n));
    parts.sort((a, b) => rank(a.name) - rank(b.name));
    return `<w:tblPr>${parts.map((x) => x.xml).join('')}</w:tblPr>`;
  });
}

// Border and cell-margin elements must be in schema order (top, left/start, bottom, right/end, insideH, insideV);
// html-to-docx writes top, bottom, left, right, which Word rejects.
const BORDER_ORDER = ['top', 'left', 'start', 'bottom', 'right', 'end', 'insideH', 'insideV', 'tl2br', 'tr2bl', 'between', 'bar'];
export function fixBorderOrder(xml: string): string {
  return xml.replace(/<w:(tblBorders|tcBorders|pBdr|tblCellMar|tcMar)>([\s\S]*?)<\/w:\1>/g, (_m, tag, inner) => {
    const parts: { name: string; xml: string }[] = [];
    const re = /<w:(\w+)\b[^>]*?(?:\/>|>[\s\S]*?<\/w:\1>)/g;
    let t;
    while ((t = re.exec(inner))) parts.push({ name: t[1], xml: t[0] });
    const rank = (n: string) => (BORDER_ORDER.indexOf(n) < 0 ? 99 : BORDER_ORDER.indexOf(n));
    parts.sort((a, b) => rank(a.name) - rank(b.name));
    return `<w:${tag}>${parts.map((x) => x.xml).join('')}</w:${tag}>`;
  });
}

// Paragraph properties must also be in schema order (for example spacing before ind before jc);
// html-to-docx writes ind and jc before spacing for indented text such as quotes.
const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
export function fixParaPropsOrder(xml: string): string {
  return xml.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (_m, inner) => {
    const parts: { name: string; xml: string }[] = [];
    const re = /<w:(\w+)\b[^>]*?(?:\/>|>[\s\S]*?<\/w:\1>)/g;
    let t;
    while ((t = re.exec(inner))) parts.push({ name: t[1], xml: t[0] });
    const rank = (n: string) => (PPR_ORDER.indexOf(n) < 0 ? 99 : PPR_ORDER.indexOf(n));
    parts.sort((a, b) => rank(a.name) - rank(b.name));
    return `<w:pPr>${parts.map((x) => x.xml).join('')}</w:pPr>`;
  });
}
