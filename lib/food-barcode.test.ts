import { describe, expect, it } from "vitest";
import { barcodeDigits, isValidBarcodeText, normalizeBarcode, sameBarcode } from "@/lib/food-barcode";

describe("barcodes", () => {
  it("UPC-A and EAN-13 of the same product are the same code", () => {
    expect(normalizeBarcode("012345678905")).toBe("12345678905");
    expect(normalizeBarcode("0012345678905")).toBe("12345678905");
    expect(sameBarcode("012345678905", "0012345678905")).toBe(true);
    expect(sameBarcode("0012345678905", "012345678905")).toBe(true);
  });
  it("different products are different codes", () => {
    expect(sameBarcode("012345678905", "012345678912")).toBe(false);
  });
  it("keeps only digits, and an empty or all-zero code stays safe", () => {
    expect(barcodeDigits(" 0123-456 ")).toBe("0123456");
    expect(normalizeBarcode("")).toBe("");
    expect(normalizeBarcode("abc")).toBe("");
    expect(normalizeBarcode("0000000")).toBe("0");
    expect(sameBarcode("", "")).toBe(false);
  });
  it("accepts 6 to 32 digits as typed", () => {
    expect(isValidBarcodeText("12345")).toBe(false);
    expect(isValidBarcodeText("123456")).toBe(true);
    expect(isValidBarcodeText("1".repeat(32))).toBe(true);
    expect(isValidBarcodeText("1".repeat(33))).toBe(false);
    expect(isValidBarcodeText("12 345 678")).toBe(false);
  });
});
