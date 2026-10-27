import { readFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { buildShareImageModel, coachFirstNameOf, coachStripOf, coachStripPlan, drawShareImage, FALLBACK_THEME, planFor, planWithQr, qrModules, SHARE_IMAGE_SIZES, type DrawContext, type ShareImageFormat, type ShareImageInput } from "./share-image";
import { cleanInstagramHandle, INSTAGRAM_HANDLE_RULE } from "./instagram-handle";
import { loadShareCardCoach } from "./share-card-coach";

// Ron, Oct 27: "Let's do QR code and IG handle." A share picture is posted as a picture, so nothing on it is a link: a QR code to the coach's public page and their Instagram handle.
const RON_PAGE = "https://spotlightcoaching.app/c/coach-ron";
const base: ShareImageInput = {
  groupName: "The Enduring Strength Collective",
  athleteName: "Sawyer Steele",
  showName: true,
  prCount: 1,
  totalVolume: 12450,
  totalSets: 18,
  durationSeconds: 52 * 60,
  topLifts: [
    { name: "Back Squat", weight: 315, reps: 5 },
    { name: "Romanian Deadlift", weight: 225, reps: 8 },
    { name: "Bulgarian Split Squat", weight: 60, reps: 10 },
  ],
  weekStreak: 4,
  totalWorkoutCount: 31,
  createdAt: "2026-10-27T15:00:00Z",
  background: null,
  funLine: "You lifted 12,450 pounds in only 52 minutes. Too bad we can't make money at that rate.",
};

type Op = { op: string; args: unknown[]; style: string; align?: string; size?: number };
function recorder() {
  const ops: Op[] = [];
  const size = (f: string) => Number(f.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 16);
  const ctx: DrawContext = {
    font: "",
    fillStyle: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    fillRect: (...args) => void ops.push({ op: "rect", args, style: String(ctx.fillStyle) }),
    fillText: (text, x, y) => void ops.push({ op: "text", args: [text, x, y, ctx.measureText(text).width], style: String(ctx.fillStyle), align: ctx.textAlign, size: size(ctx.font) }),
    measureText: (text) => ({ width: text.length * size(ctx.font) * 0.5 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath: () => void ops.push({ op: "path", args: [], style: "" }),
    rect: (...args) => void ops.push({ op: "r", args, style: "" }),
    fill: () => void ops.push({ op: "fill", args: [], style: String(ctx.fillStyle) }),
  };
  return { ctx, ops };
}
const draw = (format: ShareImageFormat, input: ShareImageInput) => {
  const { ctx, ops } = recorder();
  drawShareImage(ctx, format, buildShareImageModel(input), FALLBACK_THEME);
  return ops;
};
const withRon = (over: Partial<NonNullable<ShareImageInput["coachStrip"]>> = {}): ShareImageInput => ({ ...base, coachStrip: { qrUrl: RON_PAGE, coachFirstName: "Coach Ron", handle: "coach.ron", ...over } });

describe("the QR code reads as the coach's public page", () => {
  it("the squares drawn are exactly the qrcode package's code for /c/<slug>, inside a white square", () => {
    for (const format of ["story", "post"] as const) {
      const ops = draw(format, withRon());
      const c = coachStripPlan(format);
      const white = ops.find((o) => o.op === "rect" && o.style === "#ffffff");
      expect(white?.args).toEqual([c.qrX, c.qrY, c.qrSize, c.qrSize]);
      const dark = ops.filter((o) => o.op === "rect" && o.style === "#000000");
      const grid = qrModules(RON_PAGE);
      const cell = c.qrSize / (grid.length + 4);
      // read the squares back into a grid and compare with the code made from the address
      const read = grid.map((row) => row.map(() => false));
      for (const d of dark) {
        const [x, y] = d.args as number[];
        read[Math.round((y - c.qrY) / cell) - 2][Math.round((x - c.qrX) / cell) - 2] = true;
      }
      expect(read, format).toEqual(grid);
      // the white border (quiet zone) is two squares wide all round: nothing dark in it
      for (const d of dark) {
        const [x, y] = d.args as number[];
        expect(x).toBeGreaterThanOrEqual(c.qrX + 2 * cell - 0.01);
        expect(y).toBeGreaterThanOrEqual(c.qrY + 2 * cell - 0.01);
        expect(x + cell).toBeLessThanOrEqual(c.qrX + c.qrSize - 2 * cell + 0.01);
      }
    }
    const made = QRCode.create(RON_PAGE, { errorCorrectionLevel: "M" });
    expect(qrModules(RON_PAGE)[0].length).toBe(made.modules.size);
    expect(qrModules(RON_PAGE)[0][0]).toBe(true); // a finder pattern's corner
  });

  it("sits inside the frame and the story's safe area, clear of the top lifts, the fun line and the footer, in both formats", () => {
    for (const format of ["story", "post"] as const) {
      const { width, height } = SHARE_IMAGE_SIZES[format];
      const c = coachStripPlan(format);
      const p = planWithQr(format);
      const ops = draw(format, withRon());
      // big enough to scan from another phone's screen: about 6 px a square (story about 200 px, post about 165 px)
      expect(c.qrSize / (qrModules(RON_PAGE).length + 4), format).toBeGreaterThanOrEqual(4.9);
      expect(c.qrSize).toBe(format === "story" ? 200 : 165);
      expect(c.qrX).toBeGreaterThanOrEqual(p.margin);
      expect(c.qrX + c.qrSize).toBeLessThanOrEqual(width - p.margin);
      expect(c.qrY + c.qrSize).toBeLessThanOrEqual(format === "story" ? p.footerY + 80 : height);
      if (format === "story") expect(c.qrY + c.qrSize).toBeLessThanOrEqual(height - 240);
      // the lift rows (shorter when the code is there) end above the code
      const lastLiftBottom = p.liftsStartY + 3 * p.liftRowH + 2 * p.liftGap;
      expect(c.qrY, format).toBeGreaterThan(lastLiftBottom);
      // a story with the mascot (two lift rows, lower down) too
      if (format === "story") {
        const pm = planWithQr("story", true);
        expect(coachStripPlan("story", true).qrY).toBeGreaterThan(pm.liftsStartY + 2 * pm.liftRowH + pm.liftGap);
        expect(coachStripPlan("story", true).qrY + 200).toBeLessThanOrEqual(height - 240);
      }
      // the fun line's last line ends above it
      expect(c.qrY, format).toBeGreaterThan(p.funY + p.funLineH + 8);
      // every text stays in the frame, and no text but the corner's own is right of the code's left edge at its height
      for (const t of ops.filter((o) => o.op === "text")) {
        const [text, x, y, w] = t.args as [string, number, number, number];
        const left = t.align === "center" ? x - w / 2 : t.align === "right" ? x - w : x;
        expect(left, text).toBeGreaterThanOrEqual(0);
        expect(left + w, text).toBeLessThanOrEqual(width);
        if (y > c.qrY && y - (t.size ?? 0) < c.qrY + c.qrSize) expect(left + w, text).toBeLessThanOrEqual(c.qrX);
      }
    }
  });

  it("carries the line and the handle, and nothing about the person who trained beyond what the card already showed", () => {
    for (const format of ["story", "post"] as const) {
      const texts = (input: ShareImageInput) => draw(format, input).filter((o) => o.op === "text").map((o) => o.args[0] as string);
      const plain = texts(base);
      const strip = texts(withRon());
      expect(strip).toContain("Train with Ron");
      expect(strip).toContain("@coach.ron");
      expect(strip.filter((t) => !plain.includes(t)).sort()).toEqual(["@coach.ron", "Train with Ron"]);
      // no handle: the line only
      expect(texts(withRon({ handle: null })).filter((t) => !plain.includes(t))).toEqual(["Train with Ron"]);
    }
    expect(coachStripOf({ qrUrl: RON_PAGE, coachFirstName: "Ron Arnold", handle: "@@ronarnold" })).toEqual({ qrUrl: RON_PAGE, line: "Train with Ron", handle: "@ronarnold" });
    // a leading "Coach" is a title (Ron's profile name is "Coach Ron")
    expect(coachFirstNameOf("Coach Ron")).toBe("Ron");
    expect(coachFirstNameOf("Coach")).toBe("Coach");
    expect(coachFirstNameOf("Maria Guerrero")).toBe("Maria");
    expect(coachFirstNameOf("")).toBe("your coach");
  });

  it("a handle with the code off: the line and the handle, no code", () => {
    const ops = draw("story", withRon({ qrUrl: null }));
    expect(ops.some((o) => o.op === "rect" && (o.style === "#ffffff" || o.style === "#000000"))).toBe(false);
    const texts = ops.filter((o) => o.op === "text").map((o) => o.args[0]);
    expect(texts).toContain("@coach.ron");
  });

  it("with neither, the picture is drawn exactly as before (the same calls, the footer centred)", () => {
    for (const format of ["story", "post"] as const) {
      const before = draw(format, base);
      expect(draw(format, { ...base, coachStrip: null })).toEqual(before);
      expect(draw(format, withRon({ qrUrl: null, handle: null }))).toEqual(before);
      expect(draw(format, withRon({ qrUrl: "  ", handle: "" }))).toEqual(before);
      const date = before.find((o) => o.op === "text" && o.args[0] === "OCT 27, 2026");
      expect(date?.align).toBe("center");
    }
  });
});

describe("the Instagram handle", () => {
  it("is cleaned from @name and an instagram.com address; bad characters are refused with the rule", () => {
    expect(cleanInstagramHandle("@coach.ron")).toEqual({ handle: "coach.ron" });
    expect(cleanInstagramHandle("  coach_ron  ")).toEqual({ handle: "coach_ron" });
    expect(cleanInstagramHandle("https://www.instagram.com/coach.ron/?hl=en")).toEqual({ handle: "coach.ron" });
    expect(cleanInstagramHandle("instagram.com/coachron")).toEqual({ handle: "coachron" });
    expect(cleanInstagramHandle("")).toEqual({ handle: null });
    expect(cleanInstagramHandle("coach ron")).toEqual({ error: INSTAGRAM_HANDLE_RULE });
    expect(cleanInstagramHandle("coach-ron")).toEqual({ error: INSTAGRAM_HANDLE_RULE });
    expect(cleanInstagramHandle("a".repeat(31))).toEqual({ error: INSTAGRAM_HANDLE_RULE });
    expect(INSTAGRAM_HANDLE_RULE).toBe("Use 1 to 30 letters, numbers, periods or underscores.");
    // the same rule as the database (0438, where the handle lives now)
    expect(readFileSync(join(__dirname, "..", "supabase/migrations/0438_ig_handle_on_coach_profile.sql"), "utf8")).toContain("instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'");
  });
});

describe("whose corner it is", () => {
  // The handle lives in the coach's own settings (coach_profiles, 0438); the page row has the address, the switch and whether it is on.
  type Seed = { page?: Record<string, unknown> | null; pageError?: boolean; site?: Record<string, unknown> | null; coach?: Record<string, unknown> | null; handle?: string | null; handleError?: boolean };
  function db(seed: Seed) {
    const result = (table: string) => {
      if (table === "group_memberships") return { data: seed.coach === undefined ? { profile_id: "ron", profiles: { full_name: "Coach Ron" } } : seed.coach, error: null };
      if (table === "coach_booking_pages") return seed.pageError ? { data: null, error: { message: "x" } } : { data: seed.page ?? null, error: null };
      if (table === "coach_sites") return { data: seed.site === undefined ? { published: true } : seed.site, error: null };
      if (table === "coach_profiles")
        return seed.handleError ? { data: null, error: { message: "column coach_profiles.instagram_handle does not exist" } } : { data: seed.handle === undefined ? { instagram_handle: "coach.ron" } : seed.handle === null ? null : { instagram_handle: seed.handle }, error: null };
      return { data: null, error: null };
    };
    return {
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        Object.assign(b, { select: () => b, eq: () => b, order: () => b, limit: () => b, maybeSingle: async () => result(table) });
        return b;
      },
    } as never;
  }
  const page = (over: Record<string, unknown> = {}) => ({ slug: "coach-ron", enabled: true, share_card_qr: true, ...over });

  it("the group's coach, with the code to their page while it shows and the switch is on, and their handle", async () => {
    expect(await loadShareCardCoach("g", db({ page: page() }))).toEqual({ qrUrl: RON_PAGE, coachFirstName: "Ron", handle: "coach.ron" });
  });
  it("no code when the page is off, not published, or the switch is off (the handle still shows)", async () => {
    for (const seed of [{ page: page({ enabled: false }) }, { page: page(), site: { published: false } }, { page: page(), site: null }, { page: page({ share_card_qr: false }) }])
      expect(await loadShareCardCoach("g", db(seed))).toEqual({ qrUrl: null, coachFirstName: "Ron", handle: "coach.ron" });
  });
  it("a coach with no public page at all: the handle, no code (Oct 27: 2 of the 3 coaches have no page)", async () => {
    expect(await loadShareCardCoach("g", db({ page: null }))).toEqual({ qrUrl: null, coachFirstName: "Ron", handle: "coach.ron" });
    expect(await loadShareCardCoach("g", db({ pageError: true }))).toEqual({ qrUrl: null, coachFirstName: "Ron", handle: "coach.ron" });
  });
  it("nothing when neither applies, when there is no coach, and before the database update (a failed handle read, no page)", async () => {
    expect(await loadShareCardCoach("g", db({ page: page({ enabled: false }), handle: null }))).toBeNull();
    expect(await loadShareCardCoach("g", db({ page: null, handle: null }))).toBeNull();
    expect(await loadShareCardCoach("g", db({ coach: null, page: page() }))).toBeNull();
    expect(await loadShareCardCoach("g", db({ page: null, handleError: true }))).toBeNull();
    // before the update with a page showing: the code alone
    expect(await loadShareCardCoach("g", db({ page: page(), handleError: true }))).toEqual({ qrUrl: RON_PAGE, coachFirstName: "Ron", handle: null });
  });
});

describe("where it is wired", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  it("the share page hands the group's coach to the picture; both settings screens show the two fields", () => {
    expect(read("app/share/[postId]/page.tsx")).toContain("coachStrip: await loadShareCardCoach(shared.groupId),");
    expect(read("components/coach/desktop/availability-settings.tsx")).toContain("{shareCard && <ShareCardSettings coachId={coachId}");
    expect(read("app/(coach)/groups/[groupId]/business/booking-page/page.tsx")).toContain("{shareCard && <ShareCardSettings coachId={user.id}");
    const settings = read("components/coach/share-card-settings.tsx");
    expect(settings).toContain("<InstagramHandleField coachId={coachId} initialHandle={initialHandle}");
    expect(settings).toContain("Put a QR code to my public page on my clients&apos; share cards");
    const field = read("components/coach/instagram-handle-field.tsx");
    expect(field).toContain("Instagram handle");
    expect(field).toContain("cleanInstagramHandle(handle)");
  });
});
