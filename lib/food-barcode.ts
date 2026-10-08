// Barcodes come in two shapes that mean the same product: UPC-A has 12 digits and EAN-13 has 13 (the same code with a leading 0). A scanner may report either, so a food saved from
// one scan has to be found by the other. Everything is stored and compared with the leading zeros removed.

// The digits of what was scanned or typed ("" when there are none).
export const barcodeDigits = (text: string): string => text.replace(/\D/g, "");

// The form stored and compared: digits only, leading zeros removed (a code that is all zeros keeps one).
export function normalizeBarcode(text: string): string {
  const d = barcodeDigits(text);
  if (d === "") return "";
  const stripped = d.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

// Whether two codes are the same product.
export const sameBarcode = (a: string, b: string): boolean => {
  const x = normalizeBarcode(a);
  return x !== "" && x === normalizeBarcode(b);
};

// What a person may enter: 6 to 32 digits as typed or scanned (checked before the zeros are removed).
export const isValidBarcodeText = (text: string): boolean => /^\d{6,32}$/.test(text.trim());
