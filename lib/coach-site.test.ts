import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanSite, contrastText, hasSiteContent, ownImagePath, pickBrandOrg, reviewsFromJson, safeWebUrl, siteColors } from "./coach-site";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const COACH = "11111111-1111-1111-1111-111111111111";

describe("what a coach types for their page is trimmed and limited", () => {
  it("cuts to the limits, drops empties, keeps only a first name", () => {
    const c = cleanSite({
      headline: "  Strength  ",
      whyLines: ["a", " ", "b", "c", "d"],
      reviews: [{ quote: "Great", first_name: "Ann Smith" }, { quote: "", first_name: "X" }, { quote: "q2" }, { quote: "q3", first_name: "Bo" }, { quote: "q4" }],
      background: "neon",
    });
    expect(c.headline).toBe("Strength");
    expect(c.whyLines).toEqual(["a", "b", "c"]);
    expect(c.reviews.map((r) => r.first_name)).toEqual(["Ann", "", "Bo"]);
    expect(c.reviews.length).toBe(3);
    expect(c.background).toBe("dark");
    expect(hasSiteContent(cleanSite({}))).toBe(false);
  });
  it("reads the saved reviews back safely", () => {
    expect(reviewsFromJson([{ quote: "ok", first_name: "A" }, 5, null])).toEqual([{ quote: "ok", first_name: "A" }]);
    expect(reviewsFromJson("nope")).toEqual([]);
  });
});

describe("the page's colours come from the brand", () => {
  const brand = { backgroundColor: "#1C1B1A", textColor: "#EDE8E0", accentColor: "#D2703B" };
  it("dark uses the brand ground, light a plain ground, brand uses the accent with readable text", () => {
    expect(siteColors("dark", brand).bg).toBe("#1C1B1A");
    expect(siteColors("light", brand).bg).toBe("#F7F6F3");
    const b = siteColors("brand", brand);
    expect(b.bg).toBe("#D2703B");
    expect(b.text).toBe(contrastText("#D2703B"));
    expect(contrastText("#FFFFFF")).toBe("#1C1B1A");
    expect(contrastText("#000000")).toBe("#F5F2EC");
  });
});

describe("only safe things are shown", () => {
  it("web addresses must be http(s); pictures must sit in the coach's own folder", () => {
    expect(safeWebUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(safeWebUrl("javascript:alert(1)")).toBeNull();
    expect(safeWebUrl(null)).toBeNull();
    expect(ownImagePath(`${COACH}/site-hero.png`, COACH)).toBe(`${COACH}/site-hero.png`);
    expect(ownImagePath("22222222-2222-2222-2222-222222222222/x.png", COACH)).toBeNull();
    expect(ownImagePath(`${COACH}/../x.png`, COACH)).toBeNull();
  });
});

describe("the public page and the setup screen", () => {
  const page = read("app/c/[slug]/page.tsx");
  it("shows only a published page (or the owner's preview), reads through the server, and has no trackers or client data", () => {
    expect(page).toContain("if (!site.published && !isOwner) return null;");
    expect(page).toContain("createServiceRoleClient");
    expect(page).not.toMatch(/gtag|analytics|pixel|athlete|full_name.*athlete/i);
    expect(page).toContain('.eq("is_public", true)');
    expect(page).toContain('.eq("featured", true)');
    expect(page).toContain('rel="noopener noreferrer"');
    expect(page).toContain('target="_blank"');
  });
  it("has no Buy button (a visitor has no account); the one call to action is Book a consultation, only when booking is on", () => {
    expect(page).toContain("Book a consultation");
    expect(page).toContain("const canBook = !!page.enabled && canSignProofs() && isSendGridConfigured();");
    expect(page).not.toMatch(/>\s*Buy\b/);
  });
  it("is a public address, and unpublished by default", () => {
    expect(read("lib/supabase/middleware.ts")).toContain('pathname.startsWith("/c/")');
    expect(read("supabase/migrations/0321_coach_site.sql")).toContain("published boolean not null default false");
    expect(read("supabase/migrations/0321_coach_site.sql")).not.toMatch(/to anon|to public/);
  });
  it("the setup screen has one Publish switch and a Preview link, and uses the same plain upload error", () => {
    const s = read("components/coach/desktop/website-settings.tsx");
    expect(s).toContain("Publish my website");
    expect(s.match(/type="checkbox"/g)?.length).toBe(1);
    expect(s).toContain("?preview=1");
    expect(s).toContain("Couldn't upload that image. Try again, or contact support if it keeps happening.");
  });
  it("featured shop cards: a flag the coach sets (up to 3), shown first to clients", () => {
    expect(read("components/coach/desktop/pro-shop-manager.tsx")).toContain("Feature up to 3 cards.");
    expect(read("components/athlete/pro-shop-list.tsx")).toContain("Number(!!b.featured) - Number(!!a.featured)");
  });
});

describe("a coach in several organizations gets a stable brand", () => {
  const orgs = [
    { id: "b", created_at: "2026-03-01" },
    { id: "a", created_at: "2026-01-01" },
    { id: "c", created_at: "2026-02-01" },
  ];
  it("an organization they own beats one they only admin; among owned, the oldest; the same every time", () => {
    const own = (ids: string[], admin: string[]) => [...ids.map((id) => ({ organization_id: id, role: "owner" })), ...admin.map((id) => ({ organization_id: id, role: "admin" }))];
    expect(pickBrandOrg(own(["b", "c", "a"], []), orgs)?.id).toBe("a");
    expect(pickBrandOrg(own(["b", "c"], ["a"]), orgs)?.id).toBe("c");
    expect(pickBrandOrg(own([], ["a"]), orgs)?.id).toBe("a");
    expect(pickBrandOrg(own(["c", "b", "a"], []), [...orgs].reverse())?.id).toBe("a");
    expect(pickBrandOrg([], orgs)).toBeNull();
  });
  it("the page uses it and the setup screen reminds the coach about permission", () => {
    expect(read("app/c/[slug]/page.tsx")).toContain("pickBrandOrg(");
    expect(read("components/coach/desktop/website-settings.tsx")).toContain("Only add a review a client has agreed to.");
  });
});
