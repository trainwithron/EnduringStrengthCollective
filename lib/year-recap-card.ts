import { getVolumeEquivalence } from "@/lib/volume-equivalence";
import { greetingFirstName } from "@/lib/first-name";
import { lbToKg, type WeightUnit } from "@/lib/units";
import { cssColor, fitText, wrapLines, type DrawContext, type ShareTheme } from "@/lib/share-image";
import type { YearRecap } from "@/lib/year-recap";

// The December recap PICTURE (wave 2, P7; Ron approved the Recap mockup Nov 20): the client's own year on one portrait picture, made on the phone and handed to
// the phone's share sheet only when the client taps Share (or saved when they tap Save). It is private until then: nothing is posted and there is no link. The
// model is pure (tested); the drawing follows the workout share card's (lib/share-image.ts): a plain canvas, the organization's own colours and fonts.
// No verse or slogan on it (Ron has not approved wording). No straight quotes in any line: the apostrophe is ’.

export const RECAP_SIZE = { width: 1080, height: 1920 };

export interface RecapRollupRow {
  at: string; // ISO
  exerciseName: string;
  bestWeight: number | null;
}

/** The lift trained most in the year (the most workouts it was in), with its best weight that year. Heavier wins a tie. Null when no lift had a weight. */
export function topLiftOfYear(rows: RecapRollupRow[], year: number, dateKeyOf: (iso: string) => string): { name: string; sessions: number; bestWeight: number } | null {
  const by = new Map<string, { name: string; sessions: number; bestWeight: number; latest: string }>();
  for (const r of rows) {
    if (!dateKeyOf(r.at).startsWith(`${year}-`)) continue;
    const key = r.exerciseName.trim().toLowerCase();
    if (!key) continue;
    const e = by.get(key) ?? { name: r.exerciseName.trim(), sessions: 0, bestWeight: 0, latest: r.at };
    e.sessions++;
    if (r.bestWeight != null && r.bestWeight > e.bestWeight) e.bestWeight = r.bestWeight;
    if (r.at > e.latest) {
      e.latest = r.at;
      e.name = r.exerciseName.trim();
    }
    by.set(key, e);
  }
  const ranked = [...by.values()].filter((e) => e.bestWeight > 0).sort((a, b) => b.sessions - a.sessions || b.bestWeight - a.bestWeight || a.name.localeCompare(b.name));
  const top = ranked[0];
  return top ? { name: top.name, sessions: top.sessions, bestWeight: top.bestWeight } : null;
}

/** The lifts of the year with how many workouts each was in (for yearRecap's top lifts). */
export function liftsOfYear(rows: RecapRollupRow[], year: number, dateKeyOf: (iso: string) => string): { name: string; sessions: number }[] {
  const by = new Map<string, { name: string; sessions: number }>();
  for (const r of rows) {
    if (!dateKeyOf(r.at).startsWith(`${year}-`)) continue;
    const key = r.exerciseName.trim().toLowerCase();
    if (!key) continue;
    const e = by.get(key) ?? { name: r.exerciseName.trim(), sessions: 0 };
    e.sessions++;
    by.set(key, e);
  }
  return [...by.values()];
}

const trimZero = (n: number) => String(Number(n.toFixed(1)));

/** "1.2M", "245K", "980": a big number short enough for a tile. */
export function compactNumber(n: number): string {
  const v = Math.round(n);
  if (v >= 1_000_000) return `${trimZero(v / 1_000_000)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}K`;
  return v.toLocaleString("en-US");
}

/** "1.2 million pounds", "245 thousand pounds", "980 pounds" (or kilograms). */
export function amountInWords(n: number, unitWord: string): string {
  const v = Math.round(n);
  if (v >= 1_000_000) return `${trimZero(v / 1_000_000)} million ${unitWord}`;
  if (v >= 10_000) return `${Math.round(v / 1000)} thousand ${unitWord}`;
  return `${v.toLocaleString("en-US")} ${unitWord}`;
}

const curly = (s: string) => s.replace(/'/g, "’").replace(/"([^"]*)"/g, "“$1”");

/**
 * The comparison line: "That’s 1.2 million pounds, about the weight of 4 blue whales." The pop-culture units first (Ron: the comparison people post), the plain
 * list when none fits. The count comes from lib/volume-equivalence.ts, which works it out from the real pounds. Null when nothing was lifted.
 */
export function comparisonLine(volumeLbs: number, unit: WeightUnit, seed: string): string | null {
  if (!(volumeLbs > 0)) return null;
  const eq = getVolumeEquivalence(volumeLbs, seed, { popOnly: true }) ?? getVolumeEquivalence(volumeLbs, seed);
  if (!eq) return null;
  const amount = unit === "kg" ? amountInWords(lbToKg(volumeLbs), "kilograms") : amountInWords(volumeLbs, "pounds");
  // The label may already say "about" ("about one Snorlax", "about 280 thousand jellybeans"): it is never said twice.
  const what = /^about\s/.test(eq.label) ? `the weight of ${eq.label}` : `about the weight of ${eq.label}`;
  return curly(`That's ${amount}, ${what}.`);
}

export interface RecapTile {
  label: string;
  value: string;
  sub?: string; // a second, smaller line (the top lift's weight)
}

export interface RecapCardModel {
  year: number;
  orgName: string;
  heading: string; // "Sam’s year"
  titleTop: string; // "Showed up"
  titleBottom: string; // "142 times"
  tiles: RecapTile[];
  comparison: string | null;
  footerLeft: string | null; // "Coached by Coach Ron"
  footerRight: string;
  alt: string; // the picture in words, for a screen reader
}

export const RECAP_FOOTER_RIGHT = "spotlightcoaching.app";

export function buildRecapCardModel(input: {
  recap: YearRecap;
  clientName: string | null | undefined;
  coachName: string | null | undefined;
  orgName: string | null | undefined;
  unit: WeightUnit;
  topLift: { name: string; bestWeight: number } | null;
  seed: string;
}): RecapCardModel {
  const { recap, unit } = input;
  const first = greetingFirstName(input.clientName);
  const coach = greetingFirstName(input.coachName);
  const unitShort = unit === "kg" ? "kg" : "lb";
  const lifted = unit === "kg" ? lbToKg(recap.volume) : recap.volume;
  const tiles: RecapTile[] = [
    { label: "New PRs", value: String(recap.prCount) },
    { label: unit === "kg" ? "Kilos lifted" : "Pounds lifted", value: compactNumber(lifted) },
    { label: "Longest streak", value: `${recap.longestWeekStreak} wk${recap.longestWeekStreak === 1 ? "" : "s"}` },
    input.topLift
      ? {
          label: "Top lift",
          value: input.topLift.name,
          sub: `${trimZero(unit === "kg" ? lbToKg(input.topLift.bestWeight) : input.topLift.bestWeight)} ${unitShort}`,
        }
      : { label: "Minutes trained", value: compactNumber(recap.minutes) },
  ];
  const times = recap.workouts === 1 ? "1 time" : `${recap.workouts.toLocaleString("en-US")} times`;
  const comparison = comparisonLine(recap.volume, unit, input.seed);
  const heading = curly(first ? `${first}'s year` : "Your year");
  return {
    year: recap.year,
    orgName: (input.orgName ?? "").trim().toUpperCase(),
    heading,
    titleTop: "Showed up",
    titleBottom: times,
    tiles,
    comparison,
    footerLeft: coach ? `Coached by Coach ${coach}` : null,
    footerRight: RECAP_FOOTER_RIGHT,
    alt: curly(
      [`${heading} ${recap.year}: showed up ${times}.`, ...tiles.map((t) => `${t.label}: ${t.value}${t.sub ? ` ${t.sub}` : ""}.`), comparison ?? ""].filter(Boolean).join(" ")
    ),
  };
}

// ---- drawing ----

export interface RecapTheme extends ShareTheme {
  ink: string; // the accent as text (--rust-ink), held at 4.5:1 on the organization's ground
  surface: string;
}

export function readRecapTheme(base: ShareTheme): RecapTheme {
  if (typeof document === "undefined") return { ...base, ink: base.rust, surface: "rgb(26, 24, 22)" };
  const style = getComputedStyle(document.documentElement);
  return { ...base, ink: cssColor(style.getPropertyValue("--rust-ink"), base.rust), surface: cssColor(style.getPropertyValue("--surface"), "rgb(26, 24, 22)") };
}

/** "rgb(228, 167, 63)" + 0.32 -> "rgba(228, 167, 63, 0.32)"; anything else is returned as it is. */
export function withAlpha(color: string, alpha: number): string {
  const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : color;
}

function card(ctx: DrawContext, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

export function drawRecapCard(ctx: DrawContext, model: RecapCardModel, theme: RecapTheme): void {
  const { width: W, height: H } = RECAP_SIZE;
  const X = 78;
  const CW = W - 2 * X;
  const display = (size: number, weight = 700) => `${weight} ${size}px ${theme.fontDisplay}`;
  const body = (size: number, weight = 500) => `${weight} ${size}px ${theme.fontBody}`;

  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.graphite;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -110, 40, W / 2, -110, 1100);
  glow.addColorStop(0, withAlpha(theme.rust, 0.32));
  glow.addColorStop(1, withAlpha(theme.rust, 0));
  ctx.fillStyle = glow as unknown as CanvasGradient;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";
  // the top line: the organization and the year
  ctx.textAlign = "left";
  ctx.fillStyle = theme.chalk;
  if (model.orgName) {
    const org = fitText(ctx, model.orgName, CW - 200, 36, 24, (s) => display(s, 600));
    ctx.font = display(org.size, 600);
    ctx.fillText(org.text, X, 140);
  }
  ctx.textAlign = "right";
  ctx.fillStyle = theme.steel;
  ctx.font = body(34);
  ctx.fillText(String(model.year), W - X, 140);

  // whose year, and how often they showed up
  ctx.textAlign = "left";
  ctx.fillStyle = theme.ink;
  ctx.font = body(40, 600);
  ctx.fillText(fitText(ctx, model.heading, CW, 40, 28, (s) => body(s, 600)).text, X, 270);
  ctx.fillStyle = theme.chalk;
  const top = fitText(ctx, model.titleTop, CW, 156, 90, (s) => display(s));
  ctx.font = display(top.size);
  ctx.fillText(top.text, X, 430);
  const bottom = fitText(ctx, model.titleBottom, CW, 156, 90, (s) => display(s));
  ctx.font = display(bottom.size);
  ctx.fillText(bottom.text, X, 580);

  // the four tiles
  const gap = 33;
  const tw = (CW - gap) / 2;
  const th = 236;
  model.tiles.slice(0, 4).forEach((t, i) => {
    const tx = X + (i % 2) * (tw + gap);
    const ty = 660 + Math.floor(i / 2) * (th + gap);
    ctx.fillStyle = withAlpha(theme.surface, 0.85);
    card(ctx, tx, ty, tw, th, 50);
    ctx.textAlign = "left";
    ctx.fillStyle = theme.steel;
    ctx.font = body(33);
    ctx.fillText(t.label, tx + 44, ty + 72);
    ctx.fillStyle = theme.chalk;
    if (t.sub) {
      const v = fitText(ctx, t.value, tw - 88, 66, 40, (s) => display(s, 600));
      ctx.font = display(v.size, 600);
      ctx.fillText(v.text, tx + 44, ty + 150);
      ctx.font = display(58, 600);
      ctx.fillText(t.sub, tx + 44, ty + 210);
    } else {
      const v = fitText(ctx, t.value, tw - 88, 94, 50, (s) => display(s, 600));
      ctx.font = display(v.size, 600);
      ctx.fillText(v.text, tx + 44, ty + 185);
    }
  });

  // the comparison
  if (model.comparison) {
    const by = 660 + 2 * th + gap + 50;
    ctx.font = body(44);
    const lines = wrapLines(ctx, model.comparison, CW - 88, 3);
    const bh = 64 + lines.length * 60;
    ctx.fillStyle = withAlpha(theme.surface, 0.85);
    card(ctx, X, by, CW, bh, 50);
    ctx.fillStyle = theme.chalk;
    ctx.font = body(44);
    lines.forEach((line, i) => ctx.fillText(line, X + 44, by + 78 + i * 60));
  }

  // the footer
  ctx.fillStyle = theme.steel;
  ctx.font = body(33);
  if (model.footerLeft) {
    ctx.textAlign = "left";
    ctx.fillText(fitText(ctx, model.footerLeft, CW * 0.55, 33, 24, (s) => body(s)).text, X, H - 90);
  }
  ctx.textAlign = "right";
  ctx.fillText(model.footerRight, W - X, H - 90);
}

/** Draws the picture in the browser and returns the PNG. */
export async function renderRecapBlob(model: RecapCardModel, theme: RecapTheme): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = RECAP_SIZE.width;
  canvas.height = RECAP_SIZE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot make the picture.");
  try {
    await Promise.all([document.fonts.load(`700 40px ${theme.fontDisplay}`), document.fonts.load(`500 30px ${theme.fontBody}`)]);
  } catch {
    // draw with the fallback fonts
  }
  drawRecapCard(ctx as unknown as DrawContext, model, theme);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be made."))), "image/png");
  });
}
