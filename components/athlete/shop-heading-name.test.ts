import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { FeaturedShopCards } from "@/components/athlete/pro-shop-list";

const link = { id: "1", title: "Whey", category: "supplements", description: null, url: "https://example.com/whey", imageUrl: null, discountCode: null, discountDescription: null, clickCount: 0, featured: true };
const heading = (coachName: string | null) => renderToStaticMarkup(createElement(FeaturedShopCards, { links: [link as never], coachName })).match(/<h2[^>]*>([^<]*)<\/h2>/)?.[1];

describe("the Home shop heading names the coach by first name", () => {
  it("first name only, even when it has an s in it", () => {
    expect(heading("Jessica Smith")).toBe("Jessica&#x27;s Pro Shop");
    expect(heading("Rose")).toBe("Rose&#x27;s Pro Shop");
    expect(heading("Ron Arnold")).toBe("Ron&#x27;s Pro Shop");
  });
  it("plain 'Pro Shop' with no name", () => {
    expect(heading(null)).toBe("Pro Shop");
    expect(heading("  ")).toBe("Pro Shop");
  });
});
