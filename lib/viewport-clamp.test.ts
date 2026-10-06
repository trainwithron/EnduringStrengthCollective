import { describe, it, expect } from "vitest";
import { clampedLeft, clampedWidth, placeVertically } from "./viewport-clamp";

// A narrow phone, 360 css px wide.
const W = 360;

describe("clampedWidth", () => {
  it("keeps a box that already fits", () => {
    expect(clampedWidth(256, W)).toBe(256);
  });
  it("shrinks a box wider than the screen to the screen minus both margins", () => {
    expect(clampedWidth(600, W)).toBe(328);
  });
  it("never goes negative on a tiny screen", () => {
    expect(clampedWidth(300, 20)).toBe(0);
  });
});

describe("clampedLeft", () => {
  it("leaves a box that already fits where it is", () => {
    expect(clampedLeft(40, 200, W)).toBe(40);
  });
  it("pulls a box back from the right edge", () => {
    const left = clampedLeft(300, 256, W);
    expect(left + 256).toBeLessThanOrEqual(W - 16);
    expect(left).toBeGreaterThanOrEqual(16);
  });
  it("pulls a box back from the left edge (a menu opened from a button near the left)", () => {
    expect(clampedLeft(-120, 256, W)).toBe(16);
  });
  it("sits at the margin when the box is as wide as the clamped screen", () => {
    expect(clampedLeft(100, 328, W)).toBe(16);
  });
  it("every width the clamp allows ends up fully on screen at any starting point", () => {
    for (const desired of [-500, -1, 0, 10, 100, 359, 360, 900]) {
      const width = clampedWidth(480, W);
      const left = clampedLeft(desired, width, W);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(W);
    }
  });
});

describe("placeVertically", () => {
  it("goes below the anchor when there is room", () => {
    expect(placeVertically(100, 120, 80, 800)).toBe(128);
  });
  it("flips above the anchor near the bottom", () => {
    const top = placeVertically(700, 720, 120, 800);
    expect(top + 120).toBeLessThanOrEqual(700);
  });
  it("stays on screen when it fits neither way", () => {
    const top = placeVertically(150, 170, 400, 400);
    expect(top).toBeGreaterThanOrEqual(16);
  });
});
