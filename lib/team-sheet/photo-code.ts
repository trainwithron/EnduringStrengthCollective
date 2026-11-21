// Reading the printed sheet code (the QR in the bottom right corner of every team sheet page, lib/team-sheet/export-pdf.ts) from a photo, in the coach's browser, before anything is sent.
// The code says which group, rack, days, exercises and athletes the page is; the model never reads it. No code found: nothing is sent, the coach takes the photo again (nothing is guessed).
// The regions to try are pure (tested); the decoding runs in the browser only (the phone's own BarcodeDetector where there is one, else ZXing, loaded only when a photo is picked).

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The QR is about a ninth of a landscape page's width, in its bottom right corner. A photo is rarely square on, so the corner is taken generously; the whole photo is tried as well.
// A crop is decoded at the photo's own resolution (the small squares of a QR are lost when a whole photo is shrunk to fit), the whole photo at no more than MAX_DECODE_EDGE.
export const MAX_DECODE_EDGE = 2400;
export function codeRegions(width: number, height: number): Region[] {
  if (width <= 0 || height <= 0) return [];
  const corner = (fx: number, fy: number): Region => {
    const w = Math.round(width * fx);
    const h = Math.round(height * fy);
    return { x: width - w, y: height - h, width: w, height: h };
  };
  return [
    { x: 0, y: 0, width, height },
    corner(0.35, 0.45),
    corner(0.55, 0.6),
    // a photo taken upside down, or of a page turned round
    { x: 0, y: 0, width: Math.round(width * 0.35), height: Math.round(height * 0.45) },
  ];
}

/** The scale a region is drawn at to be decoded: as it is, unless it is larger than MAX_DECODE_EDGE on a side. */
export function decodeScale(region: Region, max = MAX_DECODE_EDGE): number {
  const longest = Math.max(region.width, region.height);
  return longest > max ? max / longest : 1;
}

/** The text of the sheet code in this photo, or null when none could be read. Only a code that looks like a team sheet code ("TS1.") counts. */
export async function readSheetCodeFromPhoto(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const looksRight = (t: unknown): t is string => typeof t === "string" && t.trim().startsWith("TS1.");
    const Detector = (window as any).BarcodeDetector;
    if (Detector) {
      try {
        const formats: string[] = (await Detector.getSupportedFormats?.()) ?? ["qr_code"];
        if (formats.includes("qr_code")) {
          const found = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
          const hit = (found as { rawValue?: string }[]).map((f) => f.rawValue).find(looksRight);
          if (hit) return hit.trim();
        }
      } catch {
        // fall through to ZXing
      }
    }
    const [{ BrowserQRCodeReader }, { DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserQRCodeReader(hints);
    for (const r of codeRegions(bitmap.width, bitmap.height)) {
      const scale = decodeScale(r);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(r.width * scale));
      canvas.height = Math.max(1, Math.round(r.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
      try {
        const text = reader.decodeFromCanvas(canvas).getText();
        if (looksRight(text)) return text.trim();
      } catch {
        // not found in this region; try the next
      }
    }
    return null;
  } finally {
    bitmap.close?.();
  }
}
