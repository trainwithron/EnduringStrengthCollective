import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SHARE_IMAGE_SIZES,
  FALLBACK_THEME,
  believableDurationSeconds,
  buildShareImageModel,
  cssColor,
  deliveryCapabilities,
  drawShareImage,
  firstNameOnly,
  fitText,
  formatDuration,
  wrapLines,
  planFor,
  renderShareImageBlob,
  type DrawContext,
  type ShareImageFormat,
  type ShareImageInput,
} from "./share-image";

const base: ShareImageInput = {
  groupName: "Iron Standard Barbell Club",
  athleteName: "Marcus Thompson",
  showName: true,
  prCount: 2,
  totalVolume: 12450.4,
  totalSets: 18,
  durationSeconds: 52 * 60,
  topLifts: [
    { name: "Back Squat", weight: 315, reps: 5 },
    { name: "Romanian Deadlift", weight: 225, reps: 8 },
    { name: "Bulgarian Split Squat", weight: 60, reps: 10 },
    { name: "Fourth lift never shown", weight: 10, reps: 10 },
  ],
  weekStreak: 4,
  totalWorkoutCount: 31,
  createdAt: "2026-10-06T15:00:00Z",
  background: null,
  funLine: "You lifted 12,450 pounds in only 52 minutes. Too bad we can't make money at that rate. 💸",
};

// A recording canvas: text width is a fixed fraction of the font size, so overflow can be checked without a browser.
interface Drawn {
  text: string;
  x: number;
  y: number;
  align: CanvasTextAlign;
  width: number;
  size: number;
}
function recorder() {
  const drawn: Drawn[] = [];
  const ctx: DrawContext = {
    font: "",
    fillStyle: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    fillRect() {},
    fillText(text, x, y) {
      drawn.push({ text, x, y, align: ctx.textAlign, width: ctx.measureText(text).width, size: sizeOf(ctx.font) });
    },
    measureText(text) {
      return { width: text.length * sizeOf(ctx.font) * 0.5 };
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath() {},
    rect() {},
    fill() {},
  };
  return { ctx, drawn };
}
function sizeOf(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  return m ? Number(m[1]) : 16;
}

function bounds(d: Drawn): [number, number] {
  if (d.align === "center") return [d.x - d.width / 2, d.x + d.width / 2];
  if (d.align === "right") return [d.x - d.width, d.x];
  return [d.x, d.x + d.width];
}

describe("the picture model", () => {
  it("shows three real hero stats and the top three lifts only", () => {
    const m = buildShareImageModel(base);
    expect(m.headline).toBe("NEW PR");
    expect(m.stats.map((s) => s.label)).toEqual(["LBS LIFTED", "NEW PRS", "MINUTES"]);
    expect(m.stats[0].value).toBe("12,450");
    expect(m.lifts).toHaveLength(3);
    expect(m.lifts[0]).toEqual({ name: "Back Squat", detail: "315 lbs × 5" });
  });

  it("uses the first name only, and none at all when the name is switched off", () => {
    expect(buildShareImageModel(base).name).toBe("Marcus");
    expect(buildShareImageModel({ ...base, showName: false }).name).toBeNull();
    expect(firstNameOnly("An athlete")).toBeNull();
    expect(firstNameOnly("  ")).toBeNull();
  });

  it("leaves out a PR stat and a PR headline when there was no PR", () => {
    const m = buildShareImageModel({ ...base, prCount: 0 });
    expect(m.headline).toBe("WORKOUT DONE");
    expect(m.stats.map((s) => s.label)).toEqual(["LBS LIFTED", "MINUTES", "SETS"]);
  });

  it("leaves out the time when the length is not believable", () => {
    const m = buildShareImageModel({ ...base, durationSeconds: null, prCount: 0 });
    expect(m.stats.map((s) => s.label)).toEqual(["LBS LIFTED", "SETS"]);
  });

  it("shows a streak only for two weeks or more, otherwise the workout count, never both", () => {
    expect(buildShareImageModel(base).chip).toBe("4-WEEK STREAK");
    expect(buildShareImageModel({ ...base, weekStreak: 1 }).chip).toBe("WORKOUT #31");
    expect(buildShareImageModel({ ...base, weekStreak: 0, totalWorkoutCount: 1 }).chip).toBeNull();
    expect(buildShareImageModel({ ...base, weekStreak: 0, totalWorkoutCount: null }).chip).toBeNull();
  });

  it("shows no weights and no volume for a check-in with no completed sets", () => {
    const m = buildShareImageModel({ ...base, totalSets: 0, totalVolume: 0, prCount: 0, durationSeconds: null });
    expect(m.headline).toBe("CHECKED IN");
    expect(m.stats).toEqual([]);
    expect(m.lifts).toEqual([]);
    expect(m.liftsTitle).toBeNull();
  });

  it("shows no lifts when the poster limited the card to check-in only", () => {
    const m = buildShareImageModel({ ...base, totalVolume: null, totalSets: null, topLifts: base.topLifts });
    expect(m.lifts).toEqual([]);
    expect(m.stats.map((s) => s.label)).toEqual(["NEW PRS", "MINUTES"]);
  });
});

describe("the fun line in the model", () => {
  it("is trimmed, and null when empty or missing", () => {
    expect(buildShareImageModel({ ...base, funLine: "  hello  " }).funLine).toBe("hello");
    expect(buildShareImageModel({ ...base, funLine: "" }).funLine).toBeNull();
    expect(buildShareImageModel({ ...base, funLine: undefined }).funLine).toBeNull();
  });
});

describe("wrapLines", () => {
  const { ctx } = recorder();
  ctx.font = "500 20px x"; // 10px per character in the recorder
  it("keeps short text on one line and wraps at word boundaries", () => {
    expect(wrapLines(ctx, "short line", 400, 2)).toEqual(["short line"]);
    expect(wrapLines(ctx, "aaaa bbbb cccc dddd", 100, 3)).toEqual(["aaaa bbbb", "cccc dddd"]);
  });
  it("never uses more lines than allowed, trimming the last with an ellipsis", () => {
    const lines = wrapLines(ctx, "one two three four five six seven eight nine ten", 100, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const l of lines) expect(ctx.measureText(l).width).toBeLessThanOrEqual(100);
  });
  it("does not lose or split a word that is too long for a line", () => {
    const lines = wrapLines(ctx, "supercalifragilisticexpialidocious ok", 100, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[0].startsWith("supercal")).toBe(true);
  });
  it("is empty for empty text", () => {
    expect(wrapLines(ctx, "   ", 100, 2)).toEqual([]);
  });
});

describe("session length", () => {
  it("accepts a normal length and rejects a mis-tap or a forgotten Finish", () => {
    expect(believableDurationSeconds(3120, null, null)).toBe(3120);
    expect(believableDurationSeconds(20, null, null)).toBeNull();
    expect(believableDurationSeconds(7 * 3600, null, null)).toBeNull();
  });
  it("falls back to start and end times", () => {
    expect(believableDurationSeconds(null, "2026-10-06T14:00:00Z", "2026-10-06T14:45:00Z")).toBe(2700);
    expect(believableDurationSeconds(null, null, null)).toBeNull();
  });
  it("formats minutes, then hours", () => {
    expect(formatDuration(52 * 60)).toEqual({ value: "52", label: "MINUTES" });
    expect(formatDuration(65 * 60)).toEqual({ value: "1:05", label: "HOURS" });
  });
});

describe("colours", () => {
  it("turns the stored triplet into a colour and keeps real colours", () => {
    expect(cssColor("210 112 59", "x")).toBe("rgb(210, 112, 59)");
    expect(cssColor("#908B7E", "x")).toBe("#908B7E");
    expect(cssColor("", "fallback")).toBe("fallback");
  });
});

describe("fitText", () => {
  it("shrinks long text until it fits and trims only as a last resort", () => {
    const { ctx } = recorder();
    const font = (s: number) => `700 ${s}px X`;
    const small = fitText(ctx, "Short", 400, 100, 40, font);
    expect(small).toEqual({ text: "Short", size: 100 });
    const long = fitText(ctx, "BULGARIAN SPLIT SQUAT WITH A VERY LONG NAME", 400, 100, 40, font);
    expect(long.size).toBeGreaterThanOrEqual(40);
    ctx.font = font(long.size);
    expect(ctx.measureText(long.text).width).toBeLessThanOrEqual(400);
    expect(long.text.endsWith("…")).toBe(true);
  });
});

describe.each<ShareImageFormat>(["story", "post"])("%s picture fits its frame", (format) => {
  const { width, height } = SHARE_IMAGE_SIZES[format];

  function render(overrides: Partial<ShareImageInput> = {}) {
    const { ctx, drawn } = recorder();
    drawShareImage(ctx, format, buildShareImageModel({ ...base, ...overrides }), FALLBACK_THEME);
    return drawn;
  }

  it("keeps every line inside the frame, with the longest names and numbers", () => {
    const drawn = render({
      groupName: "The Enduring Strength Collective Performance & Conditioning",
      athleteName: "Maximilian-Alexander Featherstonehaugh",
      totalVolume: 1234567.8,
      topLifts: [
        { name: "Single-Arm Dumbbell Romanian Deadlift With Pause", weight: 1000, reps: 100 },
        { name: "Bulgarian Split Squat", weight: 60, reps: 10 },
        { name: "Back Squat", weight: 315, reps: 5 },
      ],
    });
    expect(drawn.length).toBeGreaterThan(8);
    for (const d of drawn) {
      const [left, right] = bounds(d);
      expect(left, d.text).toBeGreaterThanOrEqual(0);
      expect(right, d.text).toBeLessThanOrEqual(width);
      expect(d.y, d.text).toBeGreaterThan(0);
      expect(d.y, d.text).toBeLessThanOrEqual(height);
    }
  });

  it("keeps the text clear of the story app's top and bottom bars", () => {
    if (format !== "story") return;
    const drawn = render();
    for (const d of drawn) {
      expect(d.y - d.size, d.text).toBeGreaterThanOrEqual(planFor("story").safeTop - 60);
      expect(d.y, d.text).toBeLessThanOrEqual(height - 250);
    }
  });

  it("draws the fun line in at most two lines, inside the frame, clear of the lifts and the footer", () => {
    const drawn = render({ funLine: "A very long fun line that goes on and on about how much was lifted today and how nice that was to see, honestly. 🏋️" });
    const p = planFor(format);
    const fun = drawn.filter((d) => d.size === p.funSize);
    expect(fun.length).toBeGreaterThanOrEqual(1);
    expect(fun.length).toBeLessThanOrEqual(2);
    for (const d of fun) {
      const [left, right] = bounds(d);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(width);
    }
    const lastRowBottom = p.liftsStartY + 2 * (p.liftRowH + p.liftGap) + p.liftRowH;
    const funTop = p.funY - p.funSize * 0.72;
    const funBottom = p.funY + (fun.length - 1) * p.funLineH + p.funSize * 0.08;
    if (format === "post") {
      expect(funTop).toBeGreaterThan(lastRowBottom);
      expect(funBottom).toBeLessThan(p.footerY - 40 * 0.72);
    } else {
      expect(funBottom).toBeLessThan(p.liftsTitleY - p.statLabelSize * 0.72);
      expect(funTop).toBeGreaterThan(p.chipY);
    }
  });

  it("draws nothing for the fun line when there is none", () => {
    const p = planFor(format);
    expect(render({ funLine: null }).filter((d) => d.size === p.funSize)).toHaveLength(0);
    expect(render({ funLine: "   " }).filter((d) => d.size === p.funSize)).toHaveLength(0);
  });

  it("draws the wordmark and no link", () => {
    const drawn = render();
    const text = drawn.map((d) => d.text).join(" ");
    expect(text).toContain("SPOTLIGHT");
    expect(text).not.toMatch(/https?:|www\.|\.com/i);
  });

  it("does not print the name when it is switched off", () => {
    const drawn = render({ showName: false });
    expect(drawn.map((d) => d.text)).not.toContain("Marcus");
  });

  it("does not print any weight for a check-in", () => {
    const drawn = render({ totalSets: 0, totalVolume: 0, prCount: 0, durationSeconds: null });
    expect(drawn.map((d) => d.text).join(" ")).not.toMatch(/lbs/i);
  });

  it("no two lines of text overlap, and the footer clears the last lift row", () => {
    const drawn = render();
    const boxes = drawn.map((d) => ({ text: d.text, top: d.y - d.size * 0.72, bottom: d.y + d.size * 0.08, y: d.y }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[i].y === boxes[j].y) continue; // the name and the weight of one lift row share a line
        const overlap = boxes[i].top < boxes[j].bottom && boxes[j].top < boxes[i].bottom;
        expect(overlap, `${boxes[i].text} / ${boxes[j].text}`).toBe(false);
      }
    }
    const p = planFor(format);
    const lastRowBottom = p.liftsStartY + 2 * (p.liftRowH + p.liftGap) + p.liftRowH;
    expect(lastRowBottom + 30).toBeLessThanOrEqual(p.footerY - 30);
  });

  it("lines never overlap vertically within the lift rows", () => {
    const drawn = render();
    const lifts = drawn.filter((d) => /lbs ×/.test(d.text));
    const ys = lifts.map((d) => d.y);
    expect(new Set(ys).size).toBe(ys.length);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(planFor(format).liftRowH);
  });
});

describe("picture export", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders a PNG blob at the story and post sizes", async () => {
    const sizes: { width: number; height: number }[] = [];
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const makeCanvas = () => {
      const { ctx } = recorder();
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob: (cb: (b: Blob | null) => void, type?: string) => {
          sizes.push({ width: canvas.width, height: canvas.height });
          expect(type).toBe("image/png");
          cb(png);
        },
      };
      return canvas;
    };
    vi.stubGlobal("document", { createElement: () => makeCanvas(), fonts: { load: async () => [] } });
    const story = await renderShareImageBlob(base, "story", FALLBACK_THEME);
    const post = await renderShareImageBlob(base, "post", FALLBACK_THEME);
    expect(story.type).toBe("image/png");
    expect(post.size).toBeGreaterThan(0);
    expect(sizes).toEqual([
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 },
    ]);
  });

  it("fails clearly when the canvas cannot make a picture", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => recorder().ctx, toBlob: (cb: (b: Blob | null) => void) => cb(null) }),
      fonts: { load: async () => [] },
    });
    await expect(renderShareImageBlob(base, "post", FALLBACK_THEME)).rejects.toThrow(/could not be saved/);
  });

  it("still draws if the fonts API throws", async () => {
    const png = new Blob(["x"], { type: "image/png" });
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => recorder().ctx, toBlob: (cb: (b: Blob | null) => void) => cb(png) }),
      fonts: { load: async () => { throw new Error("no fonts"); } },
    });
    await expect(renderShareImageBlob(base, "story", FALLBACK_THEME)).resolves.toBe(png);
  });
});

describe("delivery capabilities", () => {
  const file = new File(["x"], "w.png", { type: "image/png" });
  it("offers the native sheet only when the browser can share this file", () => {
    expect(deliveryCapabilities({ share: async () => {}, canShare: () => true }, false, file).nativeShare).toBe(true);
    expect(deliveryCapabilities({ share: async () => {}, canShare: () => false }, false, file).nativeShare).toBe(false);
    expect(deliveryCapabilities({}, false, file).nativeShare).toBe(false);
    expect(deliveryCapabilities({ share: async () => {}, canShare: () => true }, false, null).nativeShare).toBe(false);
  });
  it("offers copy only when images can go on the clipboard", () => {
    expect(deliveryCapabilities({ clipboard: { write: () => {} } }, true, file).copyImage).toBe(true);
    expect(deliveryCapabilities({ clipboard: { write: () => {} } }, false, file).copyImage).toBe(false);
    expect(deliveryCapabilities({}, true, file).copyImage).toBe(false);
  });
});
