import { describe, it, expect } from "vitest";
import { contrastRatio, passesAA, nearestPassingColor, hexToRgb } from "./color-contrast";

describe("relativeLuminance / contrastRatio", () => {
  it("black vs white hits the real maximum WCAG ratio (21:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("a color against itself is always 1:1", () => {
    expect(contrastRatio("#D2703B", "#D2703B")).toBeCloseTo(1, 5);
  });

  it("is symmetric — order of the two colors doesn't matter", () => {
    const a = contrastRatio("#1C1B1A", "#EDE8E0");
    const b = contrastRatio("#EDE8E0", "#1C1B1A");
    expect(a).toBeCloseTo(b!, 10);
  });

  it("returns null for a malformed hex value", () => {
    expect(contrastRatio("not-a-color", "#ffffff")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
  });

  it("matches the app's own documented default palette contrast (lib/theme.ts's own comment: clears 4.5:1)", () => {
    // DEFAULT_ACCENT_COLOR vs DEFAULT_BACKGROUND_COLOR from lib/theme.ts
    const ratio = contrastRatio("#D2703B", "#1C1B1A");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });
});

describe("passesAA", () => {
  it("4.5:1 passes normal but not a ratio just under it", () => {
    expect(passesAA(4.5, "normal")).toBe(true);
    expect(passesAA(4.49, "normal")).toBe(false);
  });

  it("3:1 passes large but not a ratio just under it", () => {
    expect(passesAA(3, "large")).toBe(true);
    expect(passesAA(2.99, "large")).toBe(false);
  });

  it("never blocks on a null ratio (malformed/mid-edit input)", () => {
    expect(passesAA(null, "normal")).toBe(true);
  });
});

describe("nearestPassingColor", () => {
  it("suggests a passing color when the original pair fails", () => {
    // Two near-identical light grays — Ron's own described failure mode.
    const failing = contrastRatio("#f0f0f0", "#e8e8e8");
    expect(failing).toBeLessThan(4.5);

    const suggestion = nearestPassingColor("#f0f0f0", "#e8e8e8", 4.5);
    expect(suggestion).not.toBeNull();
    const newRatio = contrastRatio(suggestion!, "#e8e8e8");
    expect(newRatio).not.toBeNull();
    expect(newRatio!).toBeGreaterThanOrEqual(4.5);
  });

  it("preserves hue and saturation — only lightness changes", () => {
    const suggestion = nearestPassingColor("#f0f0f0", "#e8e8e8", 4.5);
    expect(suggestion).not.toBeNull();
    // A near-white/gray input has ~0 saturation — the suggestion should
    // still be a gray (r === g === b), not have drifted to a hue.
    const rgb = hexToRgb(suggestion!);
    expect(rgb).not.toBeNull();
    expect(Math.abs(rgb!.r - rgb!.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(rgb!.g - rgb!.b)).toBeLessThanOrEqual(1);
  });

  it("returns null for malformed input rather than throwing", () => {
    expect(nearestPassingColor("nope", "#000000", 4.5)).toBeNull();
  });

  it("already-passing input still returns a valid, still-passing color", () => {
    const suggestion = nearestPassingColor("#ffffff", "#000000", 4.5);
    expect(suggestion).not.toBeNull();
    const ratio = contrastRatio(suggestion!, "#000000");
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });
});
