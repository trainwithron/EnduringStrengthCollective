import { BRAND, type BrandBackground } from "@/lib/brand";

// Draws the Spotlight mark on the share-card canvas. The canvas drawing surface the share image uses is deliberately small (rectangles, a colour, a transparency), so the
// cone and the halo are built from thin horizontal rows of rectangles: no paths, no images to load, identical on every browser, and easy to test. The shapes and colours
// are those of public/brand/spotlight-mark-*.svg (200 x 200 units, scaled to `size`).
export interface MarkSurface {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
}

export function drawSpotlightMark(ctx: MarkSurface, left: number, top: number, size: number, background: BrandBackground = "dark"): void {
  const c = background === "light" ? BRAND.palette.onLight : BRAND.palette.onDark;
  const u = size / 200;
  const rect = (x: number, y: number, w: number, h: number, color: string, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(left + x * u, top + y * u, w * u, h * u);
  };

  // The cone of light: a trapezoid from (72..128, y 38) to (24..176, y 150), fading downwards.
  const rows = Math.max(12, Math.round(112 * u));
  for (let i = 0; i < rows; i++) {
    const t = (i + 0.5) / rows;
    const y0 = 38 + (112 * i) / rows;
    const half = 28 + 48 * t;
    const alpha = c.coneAlphaTop + (c.coneAlphaBottom - c.coneAlphaTop) * t;
    rect(100 - half, y0, half * 2, 112 / rows + 0.4, c.cone, alpha);
  }

  // The halo: an ellipse ring centred (100, 30), radii 31 x 9, 7 units thick.
  const ringRows = Math.max(8, Math.round(24 * u));
  for (let i = 0; i < ringRows; i++) {
    const y = 30 - 12 + (24 * (i + 0.5)) / ringRows;
    const dy = y - 30;
    const outerHalf = 34.5 * Math.sqrt(Math.max(0, 1 - (dy * dy) / (12.5 * 12.5)));
    const innerRy = 5.5;
    const innerHalf = Math.abs(dy) < innerRy ? 27.5 * Math.sqrt(1 - (dy * dy) / (innerRy * innerRy)) : 0;
    const h = 24 / ringRows + 0.3;
    if (outerHalf <= 0) continue;
    if (innerHalf > 0) {
      rect(100 - outerHalf, y - h / 2, outerHalf - innerHalf, h, c.halo);
      rect(100 + innerHalf, y - h / 2, outerHalf - innerHalf, h, c.halo);
    } else {
      rect(100 - outerHalf, y - h / 2, outerHalf * 2, h, c.halo);
    }
  }

  // The barbell: the bar, then the two plates and their inner plates.
  rect(34, 152, 132, 7, c.bar);
  rect(44, 130, 12, 50, c.plateOuter);
  rect(144, 130, 12, 50, c.plateOuter);
  rect(58, 138, 9, 34, c.plateInner);
  rect(133, 138, 9, 34, c.plateInner);
  ctx.globalAlpha = 1;
}
