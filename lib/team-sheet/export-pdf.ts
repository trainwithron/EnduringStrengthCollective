// The printable team sheet: layout B, one landscape page per rack (more pages for a rack when a week has more exercises than fit). Boxes for each set, a Notes column, the instructions, and the sheet code as a QR.
import { buildPdf, PdfPage, PAGE_H, PAGE_W, wrapToWidth } from "@/lib/team-sheet/grid-pdf";
import { encodeSheetCode, type SheetCode } from "@/lib/team-sheet/sheet-code";
import { pageRack, type SheetModel, type SheetRack } from "@/lib/team-sheet/sheet-model";

const MARGIN = 30;
const NAME_W = 108;
const NOTES_W = 90;
const ROW_H = 52;
const DAY_BAND_H = 14;
const NAME_ROW_H = 30;
const RX_ROW_H = 12;
const TABLE_TOP = 78;
const BOX = 16;

export function instructionLines(unit: string): string[] {
  return [
    `How to fill this in: write the weight of each set in its box, in ${unit}. Write 225 for a set at 225. Write 225x5 if you did a different number of reps than the plan. Write BW for body weight and a dash if you skipped it. Leave a box empty if you did not do it.`,
    "Timed or distance work (a plank, a carry, a sprint) is not read yet: write it in Notes.",
    "Keep the sheet flat and clean. The code at the bottom right says which sheet this is. Do not cover it.",
  ];
}

export function buildSheetPdf(model: SheetModel): Buffer {
  const pages: PdfPage[] = [];
  const dayPages = pageRack(model.days);
  const totalPages = model.racks.length * dayPages.length;
  let pageNo = 0;
  for (const rack of model.racks) {
    for (let p = 0; p < dayPages.length; p++) {
      pageNo++;
      pages.push(drawRackPage(model, rack, dayPages[p], p, dayPages.length, pageNo, totalPages));
    }
  }
  if (pages.length === 0) pages.push(new PdfPage());
  return buildPdf(pages);
}

function drawRackPage(model: SheetModel, rack: SheetRack, blocks: ReturnType<typeof pageRack>[number], pageIdx: number, pagesForRack: number, pageNo: number, totalPages: number): PdfPage {
  const page = new PdfPage();
  const week = model.mode === "week";
  const first = model.days[0];
  const title = week ? `Rack ${rack.number}  -  Week of ${first.label}` : `Rack ${rack.number}  -  ${first.label}${first.title ? "  -  " + first.title : ""}`;
  page.text(MARGIN, 48, title, { size: 16, bold: true });
  const sub = `${model.groupName}  -  ${rack.athletes.length} athlete${rack.athletes.length === 1 ? "" : "s"} on this rack  -  weights in ${model.unit}${pagesForRack > 1 ? `  -  part ${pageIdx + 1} of ${pagesForRack}` : ""}  -  page ${pageNo} of ${totalPages}`;
  page.text(MARGIN, 64, sub, { size: 8.5, gray: 0.35 });

  // columns
  const exerciseCount = blocks.reduce((s, b) => s + Math.max(1, b.exercises.length), 0);
  const colW = (PAGE_W - MARGIN * 2 - NAME_W - NOTES_W) / Math.max(1, exerciseCount);
  const tableW = NAME_W + exerciseCount * colW + NOTES_W;
  let y = TABLE_TOP;

  // day bands (a week; a day sheet needs none because the title says the day)
  if (week) {
    let x = MARGIN + NAME_W;
    for (const b of blocks) {
      const w = Math.max(1, b.exercises.length) * colW;
      page.rect(x, y, w, DAY_BAND_H, { fill: 0.8, stroke: 0.4 });
      const cont = b.offset > 0 ? " (cont.)" : "";
      page.text(x + 3, y + 10, `${b.day.label}${b.day.title ? "  " + b.day.title : ""}${cont}`.slice(0, Math.floor(w / 4.6)), { size: 8, bold: true });
      x += w;
    }
    y += DAY_BAND_H;
  }

  // exercise names and prescriptions
  page.rect(MARGIN, y, NAME_W, NAME_ROW_H + RX_ROW_H, { fill: 0.9, stroke: 0.4 });
  page.text(MARGIN + 4, y + 13, "Athlete", { size: 8.5, bold: true });
  let x = MARGIN + NAME_W;
  const columns: { x: number; w: number; sets: number }[] = [];
  for (const b of blocks) {
    const list = b.exercises.length > 0 ? b.exercises : [null];
    for (const ex of list) {
      page.rect(x, y, colW, NAME_ROW_H + RX_ROW_H, { fill: 0.9, stroke: 0.4 });
      if (ex) {
        const lines = wrapToWidth(ex.name, colW - 6, 7.5, true, 3);
        lines.forEach((ln, i) => page.text(x + 3, y + 9 + i * 8.5, ln, { size: 7.5, bold: true }));
        page.text(x + 3, y + NAME_ROW_H + 9, ex.unread ? "timed: use Notes" : ex.prescription.slice(0, Math.floor((colW - 4) / 3.9)), { size: 7, gray: 0.35 });
      } else {
        page.text(x + 3, y + 12, "(no exercises)", { size: 7, gray: 0.4 });
      }
      columns.push({ x, w: colW, sets: ex && !ex.unread ? ex.sets : 0 });
      x += colW;
    }
  }
  page.rect(x, y, NOTES_W, NAME_ROW_H + RX_ROW_H, { fill: 0.9, stroke: 0.4 });
  page.text(x + 4, y + 13, "Notes", { size: 8.5, bold: true });
  y += NAME_ROW_H + RX_ROW_H;

  // athlete rows
  rack.athletes.forEach((a, i) => {
    const top = y + i * ROW_H;
    page.rect(MARGIN, top, tableW, ROW_H, { stroke: 0.4 });
    page.line(MARGIN + NAME_W, top, MARGIN + NAME_W, top + ROW_H, { gray: 0.55 });
    page.text(MARGIN + 4, top + 16, a.name, { size: 10, bold: true });
    page.text(MARGIN + 4, top + 30, String(i + 1), { size: 7.5, gray: 0.5 });
    for (const c of columns) {
      page.line(c.x + c.w, top, c.x + c.w, top + ROW_H, { gray: 0.55 });
      if (c.sets <= 0) continue;
      const perRow = Math.max(1, Math.min(c.sets, Math.floor((c.w - 4) / (BOX + 1.5))));
      const rows = Math.ceil(c.sets / perRow);
      const h = Math.min(22, (ROW_H - 8) / rows - 2);
      const w = Math.min(BOX + 8, (c.w - 4) / perRow - 1.5);
      for (let s = 0; s < c.sets; s++) {
        const r = Math.floor(s / perRow);
        const k = s % perRow;
        page.rect(c.x + 2 + k * (w + 1.5), top + 4 + r * (h + 2), w, h, { stroke: 0.3, lineWidth: 0.5 });
      }
    }
  });

  // instructions and the code
  const qrSize = 84;
  const instructionW = PAGE_W - MARGIN * 2 - qrSize - 14;
  let iy = PAGE_H - MARGIN - qrSize + 8;
  for (const text of instructionLines(model.unit)) {
    for (const ln of wrapToWidth(text, instructionW, 7.5)) {
      page.text(MARGIN, iy, ln, { size: 7.5, gray: 0.2 });
      iy += 9.5;
    }
    iy += 2;
  }
  page.qr(PAGE_W - MARGIN - qrSize, PAGE_H - MARGIN - qrSize, qrSize, encodeSheetCode(rackCode(model, rack)));
  page.text(PAGE_W - MARGIN - qrSize, PAGE_H - MARGIN - qrSize - 4, "sheet code", { size: 6.5, gray: 0.45 });
  return page;
}

export function rackCode(model: SheetModel, rack: SheetRack): SheetCode {
  return {
    v: 1,
    groupId: model.groupId,
    mode: model.mode,
    unit: model.unit,
    rack: rack.number,
    days: model.days.map((d) => ({ date: d.date, exercises: d.exercises.map((e) => e.id) })),
    athletes: rack.athletes.map((a) => a.id),
  };
}
