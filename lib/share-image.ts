import { SCENIC_SKY_STOPS, type ScenicBackgroundKey } from "@/lib/scenic-backgrounds";

// The post-workout card as a PICTURE people can post. Everything here draws on a plain canvas so the image is
// self-contained (no screenshot of the page, no link, no cross-site assets) and looks the same on every phone.
// The data going in is the same real data the card on screen shows; nothing is invented, and a stat that is not
// true for this workout is left out instead of faked.

export type ShareImageFormat = "story" | "post";

export const SHARE_IMAGE_SIZES: Record<ShareImageFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 }, // 9:16, Instagram / Facebook stories
  post: { width: 1080, height: 1080 }, // 1:1, feed posts, X
};

export const SHARE_FORMAT_LABELS: Record<ShareImageFormat, string> = { story: "Story", post: "Post" };

export interface ShareImageInput {
  groupName: string;
  // Full or partial name as stored; the picture only ever uses the first name, and only when showName is true.
  athleteName: string;
  showName: boolean;
  prCount: number;
  totalVolume: number | null;
  totalSets: number | null;
  durationSeconds: number | null;
  topLifts: { name: string; weight: number; reps: number }[];
  weekStreak: number;
  totalWorkoutCount: number | null;
  createdAt: string;
  background: ScenicBackgroundKey | null;
  // One light line (a volume comparison, or a joke), already chosen and seeded per workout by the caller so the same workout always shows the same one.
  funLine?: string | null;
}

export interface ShareImageModel {
  brand: string;
  headline: string;
  name: string | null;
  stats: { value: string; label: string }[];
  chip: string | null;
  liftsTitle: string | null;
  lifts: { name: string; detail: string }[];
  dateLabel: string;
  background: ScenicBackgroundKey | null;
  funLine: string | null;
}

const WORDMARK = "SPOTLIGHT";

// A session length worth printing: at least a minute (the app can record a few seconds for a mis-tap) and under six
// hours (almost always a Finish button forgotten overnight). Anything else is dropped rather than shown as a guess.
export function believableDurationSeconds(
  durationSeconds: number | null | undefined,
  startedAt: string | null | undefined,
  completedAt: string | null | undefined
): number | null {
  let seconds: number | null = typeof durationSeconds === "number" ? durationSeconds : null;
  if (seconds == null && startedAt && completedAt) {
    const diff = (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000;
    seconds = Number.isFinite(diff) ? Math.round(diff) : null;
  }
  if (seconds == null || seconds < 60 || seconds > 6 * 3600) return null;
  return seconds;
}

export function formatDuration(seconds: number): { value: string; label: string } {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { value: String(minutes), label: "MINUTES" };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { value: `${h}:${String(m).padStart(2, "0")}`, label: "HOURS" };
}

export function firstNameOnly(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || first === "An") return null; // "An athlete", the placeholder for an unknown name
  return first;
}

export function buildShareImageModel(input: ShareImageInput): ShareImageModel {
  const didWork = (input.totalSets ?? 0) > 0 && input.totalVolume != null;
  const hasPr = input.prCount > 0;

  const stats: { value: string; label: string }[] = [];
  if (didWork) stats.push({ value: Math.round(input.totalVolume as number).toLocaleString("en-US"), label: "LBS LIFTED" });
  if (hasPr) stats.push({ value: String(input.prCount), label: input.prCount === 1 ? "NEW PR" : "NEW PRS" });
  if (input.durationSeconds != null) stats.push(formatDuration(input.durationSeconds));
  if (stats.length < 3 && didWork) stats.push({ value: String(input.totalSets), label: input.totalSets === 1 ? "SET" : "SETS" });

  // One extra line of real context, never both and never invented: a streak of two or more weeks in a row, otherwise
  // the running count of workouts logged.
  let chip: string | null = null;
  if (input.weekStreak >= 2) chip = `${input.weekStreak}-WEEK STREAK`;
  else if (input.totalWorkoutCount != null && input.totalWorkoutCount >= 2) chip = `WORKOUT #${input.totalWorkoutCount}`;

  const lifts = didWork
    ? input.topLifts.slice(0, 3).map((l) => ({ name: l.name, detail: `${l.weight} lbs × ${l.reps}` }))
    : [];

  return {
    brand: input.groupName,
    headline: hasPr ? "NEW PR" : didWork ? "WORKOUT DONE" : "CHECKED IN",
    name: input.showName ? firstNameOnly(input.athleteName) : null,
    stats: stats.slice(0, 3),
    chip,
    liftsTitle: lifts.length > 0 ? "TOP LIFTS" : null,
    lifts,
    dateLabel: new Date(input.createdAt)
      .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      .toUpperCase(),
    background: input.background,
    funLine: input.funLine?.trim() ? input.funLine.trim() : null,
  };
}

// ---- drawing ----

export interface ShareTheme {
  graphite: string;
  rust: string;
  chalk: string;
  steel: string;
  fontDisplay: string; // a CSS font-family list, e.g. '"Barlow Condensed", sans-serif'
  fontBody: string;
}

export const FALLBACK_THEME: ShareTheme = {
  graphite: "rgb(28, 27, 26)",
  rust: "rgb(210, 112, 59)",
  chalk: "rgb(237, 232, 224)",
  steel: "#908B7E",
  fontDisplay: '"Barlow Condensed", "Arial Narrow", sans-serif',
  fontBody: '"Inter", Arial, sans-serif',
};

// "210 112 59" (how the colour variables are stored) -> "rgb(210, 112, 59)". Anything else is used as it is.
export function cssColor(raw: string | null | undefined, fallback: string): string {
  const v = (raw ?? "").trim();
  if (!v) return fallback;
  const triplet = v.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (triplet) return `rgb(${triplet[1]}, ${triplet[2]}, ${triplet[3]})`;
  return v;
}

export function readShareTheme(): ShareTheme {
  if (typeof document === "undefined") return FALLBACK_THEME;
  const style = getComputedStyle(document.documentElement);
  const family = (raw: string, fallback: string, generic: string) => {
    const v = raw.trim();
    return v ? `${v}, ${generic}` : fallback;
  };
  return {
    graphite: cssColor(style.getPropertyValue("--graphite"), FALLBACK_THEME.graphite),
    rust: cssColor(style.getPropertyValue("--rust"), FALLBACK_THEME.rust),
    chalk: cssColor(style.getPropertyValue("--chalk"), FALLBACK_THEME.chalk),
    steel: cssColor(style.getPropertyValue("--steel"), FALLBACK_THEME.steel),
    fontDisplay: family(style.getPropertyValue("--font-display"), FALLBACK_THEME.fontDisplay, "sans-serif"),
    fontBody: family(style.getPropertyValue("--font-body"), FALLBACK_THEME.fontBody, "sans-serif"),
  };
}

// The slice of CanvasRenderingContext2D the drawing uses, so it can be driven by a recorder in tests.
export interface DrawContext {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void };
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): { addColorStop(offset: number, color: string): void };
  beginPath(): void;
  roundRect?(x: number, y: number, w: number, h: number, r: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
}

// Shrinks the text until it fits the width (never below minSize), then trims with an ellipsis if it still does not.
export function fitText(
  ctx: DrawContext,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
  fontFor: (size: number) => string
): { text: string; size: number } {
  let size = startSize;
  ctx.font = fontFor(size);
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = fontFor(size);
  }
  if (ctx.measureText(text).width <= maxWidth) return { text, size };
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) trimmed = trimmed.slice(0, -1);
  return { text: `${trimmed.trimEnd()}…`, size };
}

// Breaks text into at most maxLines lines that fit the width (words are never split); the last line is trimmed with an ellipsis if the text still does not fit.
export function wrapLines(ctx: DrawContext, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = words[i];
    if (lines.length === maxLines - 1) {
      current = words.slice(i).join(" ");
      break;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  const last = lines.length - 1;
  if (last >= 0 && ctx.measureText(lines[last]).width > maxWidth) {
    let t = lines[last];
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    lines[last] = `${t.trimEnd()}…`;
  }
  return lines;
}

interface Plan {
  safeTop: number; // story UIs (Instagram, Facebook) cover the top and bottom of the frame
  brandY: number;
  brandSize: number;
  headlineY: number;
  headlineSize: number;
  nameY: number;
  nameSize: number;
  statsY: number;
  statValueSize: number;
  statLabelSize: number;
  chipY: number;
  funY: number; // baseline of the first line of the fun line
  funSize: number;
  funLineH: number;
  liftsTitleY: number;
  liftsStartY: number;
  liftRowH: number;
  liftGap: number;
  footerY: number;
  margin: number;
}

export function planFor(format: ShareImageFormat): Plan {
  if (format === "story") {
    return {
      safeTop: 250,
      brandY: 320,
      brandSize: 44,
      headlineY: 520,
      headlineSize: 220,
      nameY: 610,
      nameSize: 64,
      statsY: 740,
      statValueSize: 120,
      statLabelSize: 32,
      chipY: 960,
      funY: 1040,
      funSize: 36,
      funLineH: 46,
      liftsTitleY: 1150,
      liftsStartY: 1186,
      liftRowH: 104,
      liftGap: 14,
      footerY: 1604,
      margin: 90,
    };
  }
  return {
    safeTop: 0,
    brandY: 92,
    brandSize: 36,
    headlineY: 220,
    headlineSize: 150,
    nameY: 282,
    nameSize: 46,
    statsY: 330,
    statValueSize: 90,
    statLabelSize: 26,
    chipY: 520,
    funY: 892,
    funSize: 28,
    funLineH: 34,
    liftsTitleY: 588,
    liftsStartY: 612,
    liftRowH: 72,
    liftGap: 10,
    footerY: 968,
    margin: 80,
  };
}

function paintBackground(ctx: DrawContext, w: number, h: number, model: ShareImageModel, theme: ShareTheme) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.graphite;
  ctx.fillRect(0, 0, w, h);
  const stops = model.background ? SCENIC_SKY_STOPS[model.background] : null;
  if (stops) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    for (const [offset, color] of stops) sky.addColorStop(offset, color);
    ctx.fillStyle = sky as unknown as CanvasGradient;
    ctx.fillRect(0, 0, w, h);
    // Darken toward the bottom so the white text always reads, whichever scene was picked.
    const shade = ctx.createLinearGradient(0, h * 0.2, 0, h);
    shade.addColorStop(0, "rgba(28, 27, 26, 0.15)");
    shade.addColorStop(0.55, "rgba(28, 27, 26, 0.72)");
    shade.addColorStop(1, "rgba(28, 27, 26, 0.94)");
    ctx.fillStyle = shade as unknown as CanvasGradient;
    ctx.fillRect(0, 0, w, h);
  } else {
    const glow = ctx.createRadialGradient(w * 0.85, h * 0.12, 20, w * 0.85, h * 0.12, w * 0.9);
    glow.addColorStop(0, "rgba(210, 112, 59, 0.38)");
    glow.addColorStop(1, "rgba(210, 112, 59, 0)");
    ctx.fillStyle = glow as unknown as CanvasGradient;
    ctx.fillRect(0, 0, w, h);
  }
}

function setLetterSpacing(ctx: DrawContext, px: number) {
  // Not in every browser; the picture is still fine without it.
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  } catch {
    // ignore
  }
}

// Draws the whole picture onto the context. Pure with respect to the model and the theme: same input, same picture.
export function drawShareImage(ctx: DrawContext, format: ShareImageFormat, model: ShareImageModel, theme: ShareTheme): void {
  const { width: w, height: h } = SHARE_IMAGE_SIZES[format];
  const p = planFor(format);
  const maxText = w - p.margin * 2;
  const display = (size: number) => `700 ${size}px ${theme.fontDisplay}`;
  const body = (size: number) => `500 ${size}px ${theme.fontBody}`;

  paintBackground(ctx, w, h, model, theme);
  ctx.textBaseline = "alphabetic";

  // Brand line
  ctx.textAlign = "center";
  const brand = fitText(ctx, model.brand.toUpperCase(), maxText, p.brandSize, 22, display);
  ctx.font = display(brand.size);
  setLetterSpacing(ctx, 6);
  ctx.fillStyle = theme.rust;
  ctx.fillText(brand.text, w / 2, p.brandY);
  setLetterSpacing(ctx, 0);

  // Headline
  const headline = fitText(ctx, model.headline, maxText, p.headlineSize, 80, display);
  ctx.font = display(headline.size);
  ctx.fillStyle = theme.chalk;
  ctx.fillText(headline.text, w / 2, p.headlineY);

  // First name, when shown
  if (model.name) {
    const name = fitText(ctx, model.name, maxText, p.nameSize, 30, body);
    ctx.font = body(name.size);
    ctx.fillStyle = theme.chalk;
    ctx.fillText(name.text, w / 2, p.nameY);
  }

  // Hero stats in equal columns
  if (model.stats.length > 0) {
    const colW = maxText / model.stats.length;
    model.stats.forEach((stat, i) => {
      const cx = p.margin + colW * i + colW / 2;
      const value = fitText(ctx, stat.value, colW - 20, p.statValueSize, 44, display);
      ctx.font = display(value.size);
      ctx.fillStyle = theme.chalk;
      ctx.fillText(value.text, cx, p.statsY + p.statValueSize * 0.85);
      ctx.font = body(p.statLabelSize);
      setLetterSpacing(ctx, 3);
      ctx.fillStyle = theme.steel;
      ctx.fillText(stat.label, cx, p.statsY + p.statValueSize * 0.85 + p.statLabelSize * 1.7);
      setLetterSpacing(ctx, 0);
    });
  }

  // Real-context chip (streak or workout count)
  if (model.chip) {
    ctx.font = display(Math.round(p.statLabelSize * 1.3));
    setLetterSpacing(ctx, 4);
    ctx.fillStyle = theme.rust;
    ctx.fillText(model.chip, w / 2, p.chipY);
    setLetterSpacing(ctx, 0);
  }

  // One light line (a volume comparison or a joke), centred, at most two lines
  if (model.funLine) {
    ctx.textAlign = "center";
    ctx.font = body(p.funSize);
    ctx.fillStyle = theme.chalk;
    wrapLines(ctx, model.funLine, maxText, 2).forEach((line, i) => ctx.fillText(line, w / 2, p.funY + i * p.funLineH));
  }

  // Top lifts
  if (model.liftsTitle && model.lifts.length > 0) {
    ctx.textAlign = "left";
    ctx.font = body(p.statLabelSize);
    setLetterSpacing(ctx, 4);
    ctx.fillStyle = theme.steel;
    ctx.fillText(model.liftsTitle, p.margin, p.liftsTitleY);
    setLetterSpacing(ctx, 0);
    model.lifts.forEach((lift, i) => {
      const top = p.liftsStartY + i * (p.liftRowH + p.liftGap);
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = theme.chalk;
      ctx.fillRect(p.margin, top, maxText, p.liftRowH);
      ctx.globalAlpha = 1;
      const base = top + p.liftRowH * 0.64;
      const pad = 30;
      ctx.textAlign = "right";
      const detail = fitText(ctx, lift.detail, maxText * 0.42, Math.round(p.liftRowH * 0.34), 22, body);
      ctx.font = body(detail.size);
      ctx.fillStyle = theme.chalk;
      ctx.fillText(detail.text, p.margin + maxText - pad, base);
      const detailWidth = ctx.measureText(detail.text).width;
      ctx.textAlign = "left";
      const name = fitText(ctx, lift.name.toUpperCase(), maxText - pad * 2 - detailWidth - 24, Math.round(p.liftRowH * 0.42), 24, display);
      ctx.font = display(name.size);
      ctx.fillStyle = theme.chalk;
      ctx.fillText(name.text, p.margin + pad, base);
    });
  }

  // Footer: small wordmark, no link
  ctx.textAlign = "center";
  ctx.font = display(40);
  setLetterSpacing(ctx, 10);
  ctx.fillStyle = theme.chalk;
  ctx.fillText(WORDMARK, w / 2, p.footerY);
  setLetterSpacing(ctx, 3);
  ctx.font = body(26);
  ctx.fillStyle = theme.steel;
  ctx.fillText(model.dateLabel, w / 2, p.footerY + 46);
  setLetterSpacing(ctx, 0);
}

// Renders the picture to a PNG. Runs in the browser only.
export async function renderShareImageBlob(
  input: ShareImageInput,
  format: ShareImageFormat,
  theme: ShareTheme = readShareTheme()
): Promise<Blob> {
  const { width, height } = SHARE_IMAGE_SIZES[format];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot make the picture.");

  // Make sure the card's own fonts are ready before drawing, or the first picture can come out in a fallback font.
  try {
    await Promise.all([
      document.fonts.load(`700 40px ${theme.fontDisplay}`),
      document.fonts.load(`500 30px ${theme.fontBody}`),
    ]);
  } catch {
    // Fonts API missing or a load failed: draw with the fallback stack.
  }

  drawShareImage(ctx as unknown as DrawContext, format, buildShareImageModel(input), theme);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be saved."))), "image/png");
  });
}

// What this browser can do with a finished picture, so the buttons offer only what will work.
export type DeliveryCapabilities = { nativeShare: boolean; copyImage: boolean };

export function deliveryCapabilities(
  nav: {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
    clipboard?: { write?: unknown };
  },
  hasClipboardItem: boolean,
  file: File | null
): DeliveryCapabilities {
  const nativeShare = !!file && typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] });
  const copyImage = hasClipboardItem && typeof nav.clipboard?.write === "function";
  return { nativeShare, copyImage };
}
