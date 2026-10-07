import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BRAND, brandAppIconSrc, brandMarkSrc } from "@/lib/brand";
import { drawSpotlightMark } from "@/lib/brand-canvas";
import { SpotlightLockup, SpotlightMark } from "@/components/brand/spotlight-mark";

const publicFile = (rel: string) => new URL(`../public${rel}`, import.meta.url);

describe("the default brand: one source, and a custom logo always wins", () => {
  it("an organisation's own logo wins; otherwise the Spotlight mark that suits the background", () => {
    expect(brandMarkSrc("https://cdn.example/gym-logo.png", "dark")).toBe("https://cdn.example/gym-logo.png");
    expect(brandMarkSrc("https://cdn.example/gym-logo.png", "light")).toBe("https://cdn.example/gym-logo.png");
    expect(brandMarkSrc(null, "dark")).toBe(BRAND.assets.markOnDark);
    expect(brandMarkSrc(undefined, "light")).toBe(BRAND.assets.markOnLight);
    expect(brandMarkSrc("   ", "dark")).toBe(BRAND.assets.markOnDark); // a blank value is not a logo
    expect(brandMarkSrc(null)).toBe(BRAND.assets.markOnDark);
  });
  it("an organisation's own app icon wins; otherwise the Spotlight icon", () => {
    expect(brandAppIconSrc("https://cdn.example/icon.png")).toBe("https://cdn.example/icon.png");
    expect(brandAppIconSrc(null)).toBe(BRAND.homeScreenIcons.any512);
    expect(brandAppIconSrc("")).toBe(BRAND.homeScreenIcons.any512);
  });
  it("every file the brand names exists in public/", () => {
    for (const path of [...Object.values(BRAND.assets), ...Object.values(BRAND.homeScreenIcons)]) {
      expect(existsSync(publicFile(path)), path).toBe(true);
    }
  });
  it("the colours the canvas uses are the colours in the SVG files (so a redraw cannot drift)", () => {
    const dark = readFileSync(publicFile(BRAND.assets.markOnDark), "utf8").toUpperCase();
    const light = readFileSync(publicFile(BRAND.assets.markOnLight), "utf8").toUpperCase();
    for (const color of [BRAND.palette.onDark.cone, BRAND.palette.onDark.halo, BRAND.palette.onDark.plateOuter, BRAND.palette.onDark.plateInner]) expect(dark).toContain(color.toUpperCase());
    for (const color of [BRAND.palette.onLight.cone, BRAND.palette.onLight.halo, BRAND.palette.onLight.plateOuter, BRAND.palette.onLight.plateInner]) expect(light).toContain(color.toUpperCase());
  });
});

describe("the web app manifest keeps the custom icon rule", () => {
  it("uses the organisation's app icon when it has one, and the Spotlight home-screen icons otherwise", async () => {
    vi.resetModules();
    vi.doMock("@/lib/org-theme-server", () => ({ getViewerOrgTheme: async () => ({ orgName: "Iron Standard", appIconUrl: "https://cdn.example/iron.png", backgroundColor: "#111" }) }));
    const custom = await (await import("@/app/manifest")).default();
    expect(custom.icons?.every((i) => i.src === "https://cdn.example/iron.png")).toBe(true);
    vi.resetModules();
    vi.doMock("@/lib/org-theme-server", () => ({ getViewerOrgTheme: async () => ({ orgName: null, appIconUrl: null, backgroundColor: "#111" }) }));
    const fallback = await (await import("@/app/manifest")).default();
    expect(fallback.icons?.map((i) => i.src)).toEqual(["/icon-192.png", "/icon-512.png", "/icon-maskable-192.png", "/icon-maskable-512.png"]);
    expect(fallback.icons?.map((i) => i.src)).toEqual([BRAND.homeScreenIcons.any192, BRAND.homeScreenIcons.any512, BRAND.homeScreenIcons.maskable192, BRAND.homeScreenIcons.maskable512]);
    expect(fallback.name).toBe("Spotlight Coaching");
    vi.doUnmock("@/lib/org-theme-server");
  });
  it("the layout emits an organisation's icon as the only icon links, and the Spotlight default only when there is none", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    const custom = layout.slice(layout.indexOf("{theme.appIconUrl ? ("), layout.indexOf(") : ("));
    const fallback = layout.slice(layout.indexOf(") : ("), layout.indexOf("</head>"));
    expect(custom).toContain('<link rel="apple-touch-icon" href={theme.appIconUrl} />');
    expect(custom).toContain('<link rel="icon" href={theme.appIconUrl} />');
    expect(custom).not.toContain("BRAND.assets");
    expect(fallback).toContain("BRAND.assets.favicon");
    expect(fallback).toContain("BRAND.assets.faviconIco");
    expect(fallback).toContain("BRAND.assets.appleTouchIcon");
    // No icon files in app/: Next would emit them for every viewer, next to the organisation's own links, and the browser could pick the default.
    for (const f of ["icon.svg", "icon.png", "favicon.ico", "apple-icon.png"]) expect(existsSync(new URL(`../app/${f}`, import.meta.url)), f).toBe(false);
    for (const f of ["favicon.ico", "apple-icon.png"]) expect(existsSync(new URL(`../public/${f}`, import.meta.url)), f).toBe(true);
  });
  it("a shared link shows the Spotlight picture, with an absolute address, on the app's pages and the public share pages", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain("metadataBase: new URL(configuredAppUrl()");
    expect(layout).toContain("images: BRAND_OG_IMAGES");
    for (const page of ["../app/share/[postId]/page.tsx", "../app/share/journey/[athleteId]/page.tsx", "../app/share/milestone/[milestoneId]/page.tsx", "../app/share/transformation/[cardId]/page.tsx"]) {
      expect(readFileSync(new URL(page, import.meta.url), "utf8"), page).toContain("images: BRAND_OG_IMAGES");
    }
  });
});

describe("the mark on screen and on the share-card canvas", () => {
  it("the component shows the custom logo when given one, else the default for the background", () => {
    expect(renderToStaticMarkup(createElement(SpotlightMark, { customLogoUrl: "https://cdn.example/x.png" }))).toContain('src="https://cdn.example/x.png"');
    expect(renderToStaticMarkup(createElement(SpotlightMark, { background: "dark" }))).toContain(BRAND.assets.markOnDark);
    expect(renderToStaticMarkup(createElement(SpotlightMark, { background: "light" }))).toContain(BRAND.assets.markOnLight);
  });
  it("the lockup is real text: SPOTLIGHT with a smaller COACHING under it", () => {
    const html = renderToStaticMarkup(createElement(SpotlightLockup, {}));
    expect(html).toContain(">SPOTLIGHT<");
    expect(html).toContain(">COACHING<");
    expect(html.indexOf("SPOTLIGHT")).toBeLessThan(html.indexOf("COACHING"));
  });
  it("the canvas version draws with rectangles only, inside its box, and puts the light above the bar", () => {
    const rects: { x: number; y: number; w: number; h: number; color: string }[] = [];
    const ctx = {
      fillStyle: "" as string,
      globalAlpha: 1,
      fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, color: String(this.fillStyle) }); },
    };
    drawSpotlightMark(ctx, 100, 200, 100, "dark");
    expect(rects.length).toBeGreaterThan(30);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(100 - 0.01);
      expect(r.x + r.w).toBeLessThanOrEqual(200 + 0.01);
      expect(r.y).toBeGreaterThanOrEqual(200 - 0.01);
      expect(r.y + r.h).toBeLessThanOrEqual(300 + 0.01);
    }
    const halo = rects.filter((r) => r.color === BRAND.palette.onDark.halo && r.h < 3);
    const bar = rects.find((r) => r.color === BRAND.palette.onDark.bar && r.w > 60)!;
    expect(Math.min(...halo.map((r) => r.y))).toBeLessThan(bar.y);
    expect(ctx.globalAlpha).toBe(1); // left as it found it
  });
});
