// Word (.docx) export. html-to-docx gives every picture the same drawing id (id="1"), which
// Microsoft Word rejects ("Word experienced an error trying to open the file") although other
// programs open it. This wrapper builds the file and then gives each picture a unique id.
import HTMLtoDOCX from 'html-to-docx';
// jszip is html-to-docx's own zip library (installed with it).
import JSZip from 'jszip';

export async function htmlToDocx(html: string, options: Record<string, unknown> = {}): Promise<Buffer> {
  const raw: any = await (HTMLtoDOCX as any)(html, null, options);
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
  if (fixed === xml) return docx;
  zip.file('word/document.xml', fixed);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
