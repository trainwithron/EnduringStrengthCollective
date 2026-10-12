import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ShopCard, ShopGrid } from "@/components/shared/shop-card";
import { ProShopList } from "@/components/athlete/pro-shop-list";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const link = (id: string, title: string, featured = false, extra: Record<string, unknown> = {}) => ({
  id, title, category: "merch", description: `About ${title}`, url: `https://shop.example.com/${id}`, imageUrl: null, discountCode: null, discountDescription: null, clickCount: 0, featured, ...extra,
});

describe("the storefront card", () => {
  it("has a 4:3 picture (a quiet placeholder with none), the name, a two-line description and one Shop button that opens a new tab safely", () => {
    const withImage = renderToStaticMarkup(createElement(ShopCard, { title: "Team hoodie", description: "Heavyweight, navy.", imageUrl: "https://img.example.com/a.png", href: "https://shop.example.com/h" }));
    expect(withImage).toContain("aspect-[4/3]");
    expect(withImage).toContain('alt="Team hoodie"');
    expect(withImage).toContain("line-clamp-2");
    expect(withImage).toContain('href="https://shop.example.com/h"');
    expect(withImage).toContain('target="_blank"');
    expect(withImage).toContain('rel="noopener noreferrer"');
    expect(withImage).toContain(">Shop<");
    expect(withImage).toContain("min-h-11");
    const without = renderToStaticMarkup(createElement(ShopCard, { title: "Straps", href: "https://shop.example.com/s" }));
    expect(without).toContain("<svg");
    expect(without).not.toContain("<img");
  });
  it("the grid is two columns on a phone, three, then four wide", () => {
    expect(renderToStaticMarkup(createElement(ShopGrid, null, "x"))).toContain("grid-cols-2");
    expect(renderToStaticMarkup(createElement(ShopGrid, null, "x"))).toContain("md:grid-cols-3 xl:grid-cols-4");
  });
});

describe("the client's Pro Shop", () => {
  it("shows the featured cards first under a Featured heading, then the rest under More", () => {
    const html = renderToStaticMarkup(createElement(ProShopList, { links: [link("a", "Plain item"), link("b", "Star item", true)] }));
    expect(html.indexOf("Featured")).toBeLessThan(html.indexOf("Star item"));
    expect(html.indexOf("Star item")).toBeLessThan(html.indexOf(">More<"));
    expect(html.indexOf(">More<")).toBeLessThan(html.indexOf("Plain item"));
  });
  it("with no featured card shows one plain grid, and never a link that is not an ordinary web address", () => {
    const html = renderToStaticMarkup(createElement(ProShopList, { links: [link("a", "Plain item"), link("c", "Bad", false, { url: "javascript:alert(1)" })] }));
    expect(html).not.toContain("Featured");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Plain item");
  });
  it("says so plainly when the shop is empty", () => {
    expect(renderToStaticMarkup(createElement(ProShopList, { links: [] }))).toContain("Your coach hasn&#x27;t added anything here yet.");
  });
});

describe("the same card everywhere", () => {
  it("the coach's preview and the public mini site use the shared card", () => {
    expect(read("../coach/desktop/pro-shop-manager.tsx")).toContain("<ShopCard");
    expect(read("../../app/c/[slug]/page.tsx")).toContain("<ShopCard");
    expect(read("../athlete/pro-shop-list.tsx")).toContain("<ShopCard");
  });
});
