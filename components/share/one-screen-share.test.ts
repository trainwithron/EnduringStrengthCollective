import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HUMOR_ARCHETYPES, humorSvgMarkup } from "@/lib/humor-archetypes";
import { buildShareImageModel, drawShareImage, planFor, FALLBACK_THEME, SHARE_IMAGE_SIZES, type DrawContext, type ShareImageInput } from "@/lib/share-image";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the post-workout screen is ONE screen with one primary Share", () => {
  it("the share controls have no shape or name toggles, one Share button, a quiet Back to Home and a small See full workout", () => {
    const src = read("components/share/share-actions.tsx");
    expect(src).not.toContain("Name on");
    expect(src).not.toContain("Name off");
    expect(src).not.toContain("SHARE_FORMAT_LABELS");
    expect(src).not.toContain("Picture shape");
    expect(src).toContain('"Share"');
    expect(src).toContain("Back to Home");
    expect(src).toContain("See full workout");
    expect(src).toContain("Save image");
    expect(src).toContain("Copy image");
  });
  it("the page has one headline: the full-workout section below no longer repeats it, nor a second Share or Back to Home", () => {
    const page = read("app/share/[postId]/page.tsx");
    expect((page.match(/<h1/g) ?? []).length).toBe(0);
    expect(page).not.toContain("Workout Complete 💪\"");
    expect(page).not.toContain("Share your picture");
    expect(page).not.toContain("gymJoke");
  });
  it("the card keeps the logo clear of the content and cuts a long lift name to one line without hiding its weight", () => {
    const card = read("components/share/one-screen-card.tsx");
    expect(card).toContain('<div className="pt-[clamp(8px,1.8dvh,16px)]">');
    expect(card).toContain("truncate");
    expect(card).toContain("shrink-0");
  });
});

const base: ShareImageInput = {
  groupName: "Iron Standard",
  athleteName: "Marcus Lee",
  showName: true,
  prCount: 1,
  totalVolume: 12345,
  totalSets: 20,
  durationSeconds: 3600,
  topLifts: [
    { name: "Back Squat", weight: 315, reps: 5 },
    { name: "Bench Press", weight: 225, reps: 5 },
    { name: "Romanian Deadlift", weight: 275, reps: 8 },
  ],
  weekStreak: 3,
  totalWorkoutCount: 10,
  createdAt: "2026-10-01T12:00:00Z",
  background: null,
  funLine: "That is 12 baby elephants.",
  mascot: { key: HUMOR_ARCHETYPES[0].key, caption: HUMOR_ARCHETYPES[0].caption, avatarUrl: null, initial: "Marcus Lee" },
};

function recorder() {
  const drawn: { text: string; x: number; y: number; size: number }[] = [];
  const images: { x: number; y: number; w: number; h: number }[] = [];
  let font = "";
  let align: CanvasTextAlign = "left";
  const grad = { addColorStop() {} };
  const ctx = {
    get font() { return font; },
    set font(v: string) { font = v; },
    fillStyle: "", textAlign: "left" as CanvasTextAlign, textBaseline: "alphabetic" as CanvasTextBaseline, globalAlpha: 1,
    fillRect() {}, beginPath() {}, rect() {}, fill() {},
    fillText(text: string, x: number, y: number) {
      const size = Number(/(\d+)px/.exec(font)?.[1] ?? 0);
      drawn.push({ text, x, y, size });
    },
    measureText(text: string) { const size = Number(/(\d+)px/.exec(font)?.[1] ?? 0); return { width: text.length * size * 0.5 }; },
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    drawImage(_img: unknown, x: number, y: number, w: number, h: number) { images.push({ x, y, w, h }); },
    set _align(v: CanvasTextAlign) { align = v; },
  };
  void align;
  return { ctx: ctx as unknown as DrawContext, drawn, images };
}

describe("the mascot in the posted picture", () => {
  const { height } = SHARE_IMAGE_SIZES.story;
  it("is drawn above the brand line with its caption, and everything stays clear of the story app's bars", () => {
    const { ctx, drawn, images } = recorder();
    drawShareImage(ctx, "story", buildShareImageModel(base), FALLBACK_THEME, { mascotImage: {} });
    expect(images).toHaveLength(1);
    const p = planFor("story", true);
    expect(images[0].y).toBe(p.mascotTop);
    expect(images[0].y + images[0].h).toBeLessThan(p.mascotCaptionY);
    expect(drawn.map((d) => d.text)).toContain(HUMOR_ARCHETYPES[0].caption);
    for (const d of drawn) {
      expect(d.y - d.size, d.text).toBeGreaterThanOrEqual(p.safeTop - 60);
      expect(d.y, d.text).toBeLessThanOrEqual(height - 250);
    }
    // two lift rows at most, and the last row clears the footer
    expect(drawn.filter((d) => /lbs ×/.test(d.text))).toHaveLength(2);
    expect(p.liftsStartY + 2 * (p.liftRowH + p.liftGap) + 30).toBeLessThanOrEqual(p.footerY - 30);
    // no two lines overlap
    const boxes = drawn.map((d) => ({ t: d.text, top: d.y - d.size * 0.72, bottom: d.y + d.size * 0.08, y: d.y }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].y === boxes[j].y) continue;
      expect(boxes[i].top < boxes[j].bottom && boxes[j].top < boxes[i].bottom, `${boxes[i].t} / ${boxes[j].t}`).toBe(false);
    }
  });
  it("without a loaded mascot image the picture is made with the normal layout and three lifts", () => {
    const { ctx, drawn, images } = recorder();
    drawShareImage(ctx, "story", buildShareImageModel(base), FALLBACK_THEME);
    expect(images).toHaveLength(0);
    expect(drawn.filter((d) => /lbs ×/.test(d.text))).toHaveLength(3);
  });
  it("a card with no mascot is unchanged", () => {
    const { ctx, images } = recorder();
    drawShareImage(ctx, "story", buildShareImageModel({ ...base, mascot: null }), FALLBACK_THEME, { mascotImage: {} });
    expect(images).toHaveLength(0);
  });
  it("the mascot picture holds the person's initial when there is no photo, and never anything else typed in", () => {
    const a = HUMOR_ARCHETYPES[0];
    const noPhoto = humorSvgMarkup(a, null, "marcus");
    expect(noPhoto).toContain(">M<");
    expect(noPhoto).not.toContain("<image");
    expect(humorSvgMarkup(a, null, "<script>")).not.toContain("<script>");
    const withPhoto = humorSvgMarkup(a, "data:image/png;base64,AAAA", "Marcus");
    expect(withPhoto).toContain('<image href="data:image/png;base64,AAAA"');
    expect(withPhoto).not.toContain(">M<");
  });
});
