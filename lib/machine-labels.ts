// Print-ready machine labels (Ron, Nov 20: M3; the approved 4x6 design). One white 4 by 6 inch label per machine and per page: the gym's logo (or its initials in a circle) and
// name, the machine's name, its QR code, "Scan for how-to". The page is app/print/machine-labels; this file is its addresses and words, pure, so it is tested.
export const MACHINE_LABELS_PATH = "/print/machine-labels";
export const LABEL_CALL = "Scan for how-to";
export const LABEL_LINE = "Setup, form tips and a demo video. No app needed.";
export const LABEL_FOOTER = "spotlightcoaching.app";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every machine's label (no ids), or only the ones named.
export function machineLabelsPath(ids?: string[]): string {
  return ids && ids.length > 0 ? `${MACHINE_LABELS_PATH}?ids=${ids.join(",")}` : MACHINE_LABELS_PATH;
}

// The machines a link asks for (null: all of them). Anything that is not an id is ignored.
export function parseLabelIds(raw: string | string[] | undefined): string[] | null {
  const text = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  const ids = [...new Set(text.split(",").map((s) => s.trim().toLowerCase()).filter((s) => UUID.test(s)))];
  return ids.length > 0 ? ids.slice(0, 200) : null;
}

// "Enduring Strength Co." -> "ES" (the circle when the gym has no logo).
export function orgInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(the|of|and|co|inc|llc)$/i.test(w));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "G";
}
