// A plain-text PDF writer: letter pages, a bold title, and lines of text in Helvetica. No library: the files are short lists (a training history), and a dependency would be more code than this. The text is encoded as
// WinAnsi (anything outside Latin-1 becomes "?"), long lines are wrapped on spaces, and pages are cut at a fixed number of lines. The output is a valid PDF 1.4 file with a correct cross-reference table.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const BODY_SIZE = 10;
const LINE_H = 13;
const TITLE_SIZE = 16;
const WRAP_COLUMNS = 96;

export interface PdfLine {
  text: string;
  bold?: boolean;
}

// Characters a PDF string cannot carry as they are: the three that end or escape a string, and anything outside Latin-1.
function pdfText(s: string): string {
  let out = "";
  for (const ch of s.replace(/[\r\n\t]+/g, " ")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "(" || ch === ")") out += "\\" + ch;
    else if (code < 32) out += " ";
    else if (code > 255) out += "?";
    else out += ch;
  }
  return out;
}

export function wrapLine(text: string, columns = WRAP_COLUMNS): string[] {
  const out: string[] = [];
  let rest = text;
  const indent = /^\s*/.exec(text)![0];
  while (rest.length > columns) {
    let cut = rest.lastIndexOf(" ", columns);
    if (cut <= indent.length) cut = columns;
    out.push(rest.slice(0, cut).replace(/\s+$/, ""));
    rest = indent + rest.slice(cut).replace(/^\s+/, "");
  }
  out.push(rest);
  return out;
}

export function buildTextPdf(title: string, lines: PdfLine[]): Buffer {
  // wrap, then cut into pages
  const wrapped: PdfLine[] = [];
  for (const l of lines) for (const piece of wrapLine(l.text)) wrapped.push({ text: piece, bold: l.bold });
  const titleLines = wrapLine(title, 60);
  const pages: { y: number; text: string; bold: boolean; size: number }[][] = [];
  let current: { y: number; text: string; bold: boolean; size: number }[] = [];
  let y = PAGE_H - MARGIN;
  const push = (text: string, bold: boolean, size: number, height: number) => {
    if (y - height < MARGIN) {
      pages.push(current);
      current = [];
      y = PAGE_H - MARGIN;
    }
    y -= height;
    current.push({ y, text, bold, size });
  };
  for (const t of titleLines) push(t, true, TITLE_SIZE, TITLE_SIZE + 6);
  y -= 6;
  for (const l of wrapped) push(l.text, !!l.bold, BODY_SIZE, LINE_H);
  pages.push(current);

  // objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then (page, content) pairs
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  let next = 5;
  for (const page of pages) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);
    const body = page.map((l) => `BT /${l.bold ? "F2" : "F1"} ${l.size} Tf ${MARGIN} ${l.y.toFixed(1)} Td (${pdfText(l.text)}) Tj ET`).join("\n");
    objects[contentId] = `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
