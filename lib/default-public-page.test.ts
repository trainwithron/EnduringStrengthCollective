import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { defaultSlug, ensureDefaultPublicPage, DEFAULT_CONSULTATION } from "@/lib/default-public-page";
import { slugProblem } from "@/lib/public-booking";
import { ConsultationLinkBlock } from "@/components/coach/desktop/consultation-link-block";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Ron, Oct 19: "I just need a calendar that people can book on and I can schedule on." Every coach has the page with no setup.
describe("the default address", () => {
  it("is made from the coach's name", () => {
    expect(defaultSlug("Ron Arnold", 0)).toBe("ron-arnold");
    expect(defaultSlug("Zoë O'Brien", 0)).toBe("zoe-obrien");
    expect(slugProblem(defaultSlug("Ron Arnold", 0))).toBeNull();
  });
  it("a taken address gets a short suffix; an unusable name falls back to 'coach'", () => {
    expect(defaultSlug("Ron Arnold", 1, () => "ab12")).toBe("ron-arnold-ab12");
    expect(defaultSlug("", 0, () => "ab12")).toBe("coach-ab12");
    expect(defaultSlug("!!", 0, () => "ab12")).toBe("coach-ab12");
    expect(slugProblem(defaultSlug("A".repeat(60), 1, () => "ab12"))).toBeNull();
  });
});

function fakeDb(opts: { existing?: unknown; takenSlugs?: string[]; failTypes?: boolean } = {}) {
  const calls: { table: string; op: string; row?: any }[] = [];
  const taken = new Set(opts.takenSlugs ?? []);
  let page: any = opts.existing ?? null;
  const db: any = {
    from(table: string) {
      const q: any = {
        _op: "select",
        select: () => q,
        eq: () => q,
        limit: () => q,
        single: async () => (q._op === "insert" ? q._result : { data: page, error: null }),
        maybeSingle: async () => ({ data: page, error: null }),
        then: (resolve: any) => resolve({ data: [], error: null }),
        insert: (row: any) => {
          calls.push({ table, op: "insert", row });
          q._op = "insert";
          if (table === "coach_booking_pages") {
            if (taken.has(row.slug)) q._result = { data: null, error: { code: "23505" } };
            else {
              page = { slug: row.slug, enabled: row.enabled, accepts_requests: true };
              q._result = { data: page, error: null };
            }
          } else q._result = { data: null, error: opts.failTypes ? { message: "no" } : null };
          return q;
        },
        upsert: (row: any) => {
          calls.push({ table, op: "upsert", row });
          return q;
        },
      };
      return q;
    },
  };
  return { db, calls };
}

describe("making the page for a coach, once", () => {
  it("creates the page (on), one free Consultation type, and the published public page", async () => {
    const { db, calls } = fakeDb();
    const state = await ensureDefaultPublicPage(db, "coach1", "Ron Arnold");
    expect(state).toEqual({ slug: "ron-arnold", enabled: true, acceptsRequests: true });
    expect(calls.find((c) => c.table === "coach_booking_pages")?.row).toMatchObject({ coach_id: "coach1", slug: "ron-arnold", enabled: true });
    expect(calls.find((c) => c.table === "session_types")?.row).toMatchObject({ coach_id: "coach1", ...DEFAULT_CONSULTATION });
    expect(DEFAULT_CONSULTATION.credit_cost).toBe(0);
    expect(DEFAULT_CONSULTATION.public_visible).toBe(true);
    expect(calls.find((c) => c.table === "coach_sites")?.row).toMatchObject({ coach_id: "coach1", published: true });
  });
  it("a taken address is retried with a suffix", async () => {
    const { db } = fakeDb({ takenSlugs: ["ron-arnold"] });
    const state = await ensureDefaultPublicPage(db, "coach1", "Ron Arnold");
    expect(state?.slug).toMatch(/^ron-arnold-[a-z0-9]{1,4}$/);
  });
  it("a coach who already has a page is left exactly as they have it: nothing is created", async () => {
    const { db, calls } = fakeDb({ existing: { slug: "ron", enabled: false, accepts_requests: false } });
    const state = await ensureDefaultPublicPage(db, "coach1", "Ron Arnold");
    expect(state).toEqual({ slug: "ron", enabled: false, acceptsRequests: false });
    expect(calls).toEqual([]);
  });
  it("a failure making the extras never loses the page", async () => {
    const { db } = fakeDb({ failTypes: true });
    expect((await ensureDefaultPublicPage(db, "coach1", "Ron Arnold"))?.slug).toBe("ron-arnold");
  });
});

describe("the Availability block", () => {
  it("says what the switch does, shows the link and the second switch, with no address to pick", () => {
    const html = renderToStaticMarkup(createElement(ConsultationLinkBlock, { coachId: "c", slug: "ron-arnold", enabled: true, acceptsRequests: true, hasOpenHours: true }));
    expect(html).toContain("Anyone can book a consultation with me");
    expect(html).toContain("/c/ron-arnold");
    expect(html).toContain("Copy");
    expect(html).toContain("Let people ask to train with me");
    expect(html).not.toMatch(/Your address|slug/i);
  });
  it("off says the link shows 'not available'; no hours says to add them", () => {
    expect(renderToStaticMarkup(createElement(ConsultationLinkBlock, { coachId: "c", slug: "x1x", enabled: false, acceptsRequests: true, hasOpenHours: true }))).toContain("not available");
    expect(renderToStaticMarkup(createElement(ConsultationLinkBlock, { coachId: "c", slug: "x1x", enabled: true, acceptsRequests: true, hasOpenHours: false }))).toContain("Add your open hours below");
  });
  it("sits in Calendar > Availability under 'How clients book', after making the page", () => {
    const src = read("components/coach/desktop/availability-settings.tsx");
    expect(src.indexOf("ensureDefaultPublicPage(")).toBeLessThan(src.indexOf("<ConsultationLinkBlock"));
    expect(src.indexOf("<BookingModeSelect")).toBeLessThan(src.indexOf("<ConsultationLinkBlock"));
  });
});

describe("the public link", () => {
  it("shows a plain 'not available' page when the switch is off, except to the coach previewing it", () => {
    const page = read("app/c/[slug]/page.tsx");
    expect(page).toContain("if (!page.enabled && !isOwner) return null;");
  });
});
