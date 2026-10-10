import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_BRAND_FONTS, baseFontFamilies, googleFontsHref } from "@/lib/google-fonts";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the fonts stylesheet", () => {
  it("the default look asks for exactly the platform's two fonts, with the weights it always had", () => {
    expect(googleFontsHref(baseFontFamilies({ fontDisplay: "Barlow Condensed", fontBody: "Inter" }))).toBe(
      "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&display=swap"
    );
  });
  it("an organization's own choice is added, once", () => {
    const href = googleFontsHref(baseFontFamilies({ fontDisplay: "Oswald", fontBody: "Roboto" }));
    expect(href).toContain("family=Oswald:wght@500;700");
    expect(href).toContain("family=Roboto:wght@400;500;600");
    expect(href.match(/family=Inter/g)?.length).toBe(1);
  });
  it("the full set is the same eight families the layout used to load for everyone", () => {
    const href = googleFontsHref(ALL_BRAND_FONTS.concat(["Inter"]));
    for (const f of ["Barlow+Condensed:wght@600;700", "Inter:wght@400;500;600", "Oswald:wght@500;700", "Bebas+Neue", "Anton", "Roboto:wght@400;500;600", "Work+Sans:wght@400;500;600", "Nunito+Sans:wght@400;600;700"]) {
      expect(href).toContain(`family=${f}`);
    }
    expect(href.endsWith("&display=swap")).toBe(true);
  });
  it("an unknown font name is never put in the address", () => {
    expect(googleFontsHref(["Inter", "Not A Font"])).toBe("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap");
  });
  it("the layout uses the small set and the branding page loads the full one", () => {
    expect(read("app/layout.tsx")).toContain("googleFontsHref(baseFontFamilies(theme))");
    expect(read("app/(coach)/groups/[groupId]/branding/page.tsx")).toContain("googleFontsHref(ALL_BRAND_FONTS)");
  });
});
