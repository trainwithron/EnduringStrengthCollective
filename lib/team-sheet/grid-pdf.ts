// A small PDF writer for the team sheet: landscape letter pages with rectangles, lines, text (Helvetica) and a QR code drawn as vector squares. No library, like lib/simple-pdf.ts. Text is WinAnsi
// (anything outside Latin-1 becomes "?"). Coordinates are in points from the TOP-LEFT of the page, which is how a sheet is laid out; they are turned into PDF coordinates here.
import { deflateSync } from "node:zlib";
import QRCode from "qrcode";

export const PAGE_W = 792; // landscape letter
export const PAGE_H = 612;

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

const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Average width of Helvetica text, close enough to wrap names and notes to a box. */
export function textWidth(text: string, size: number, bold = false): number {
  return text.length * size * (bold ? 0.56 : 0.52);
}

/** Cut text into lines that fit a width (breaks on spaces; a word too long for the width is cut). */
export function wrapToWidth(text: string, width: number, size: number, bold = false, maxLines = 99): string[] {
  const maxChars = Math.max(1, Math.floor(width / (size * (bold ? 0.56 : 0.52))));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let w of words) {
    while (w.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(0, maxChars - 1)) + "...";
    return kept;
  }
  return lines.length ? lines : [""];
}

export class PdfPage {
  readonly ops: string[] = [];
  /** gray level 0 (black) to 1 (white) */
  private gray(v: number, stroke: boolean) {
    this.ops.push(`${n(v)} ${stroke ? "G" : "g"}`);
  }
  rect(x: number, y: number, w: number, h: number, opts: { fill?: number; stroke?: number; lineWidth?: number } = {}) {
    const py = PAGE_H - y - h;
    if (opts.fill !== undefined) {
      this.gray(opts.fill, false);
      this.ops.push(`${n(x)} ${n(py)} ${n(w)} ${n(h)} re f`);
    }
    if (opts.stroke !== undefined) {
      this.gray(opts.stroke, true);
      this.ops.push(`${n(opts.lineWidth ?? 0.6)} w ${n(x)} ${n(py)} ${n(w)} ${n(h)} re S`);
    }
  }
  line(x1: number, y1: number, x2: number, y2: number, opts: { gray?: number; lineWidth?: number } = {}) {
    this.gray(opts.gray ?? 0, true);
    this.ops.push(`${n(opts.lineWidth ?? 0.6)} w ${n(x1)} ${n(PAGE_H - y1)} m ${n(x2)} ${n(PAGE_H - y2)} l S`);
  }
  /** text with its baseline at y (from the top) */
  text(x: number, y: number, s: string, opts: { size?: number; bold?: boolean; gray?: number } = {}) {
    this.gray(opts.gray ?? 0, false);
    this.ops.push(`BT /${opts.bold ? "F2" : "F1"} ${n(opts.size ?? 9)} Tf ${n(x)} ${n(PAGE_H - y)} Td (${pdfText(s)}) Tj ET`);
  }
  /** a QR code of `data`, drawn as squares inside a `size` x `size` box (plus a quiet margin of one module) */
  qr(x: number, y: number, size: number, data: string) {
    const qr = QRCode.create(data, { errorCorrectionLevel: "L" });
    const count = qr.modules.size;
    const cell = size / (count + 2);
    this.rect(x, y, size, size, { fill: 1 });
    this.gray(0, false);
    for (let r = 0; r < count; r++) {
      let c = 0;
      while (c < count) {
        if (!qr.modules.get(r, c)) {
          c++;
          continue;
        }
        let end = c;
        while (end < count && qr.modules.get(r, end)) end++;
        // a run of dark squares in one row is one rectangle
        this.ops.push(`${n(x + (c + 1) * cell)} ${n(PAGE_H - (y + (r + 1) * cell) - cell)} ${n((end - c) * cell)} ${n(cell + 0.15)} re f`);
        c = end;
      }
    }
  }
}

export function buildPdf(pages: PdfPage[]): Buffer {
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
    // the page content is compressed: a QR is thousands of small squares, and a large roster uncompressed would be too big to send
    const body = deflateSync(Buffer.from(page.ops.join("\n"), "latin1")).toString("latin1");
    objects[contentId] = `<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n${body}\nendstream`;
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
