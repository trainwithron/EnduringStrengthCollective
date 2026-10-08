import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { BetaBanner, WhyIBuiltThis, BETA_BANNER, WHY_I_BUILT_THIS, FOUNDER_SIGN_OFF } from "./founder-note";
import { Differentiation } from "./differentiation";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("the landing page words", () => {
  it("the beta banner says it plainly", () => {
    const html = renderToStaticMarkup(createElement(BetaBanner));
    expect(html).toContain("V1, and it&#x27;s a beta.");
    expect(html).toContain("This is as good as I can make it on my own right now.");
    expect(html).toContain("tell me and I&#x27;ll build it.");
    expect(BETA_BANNER).toMatch(/^V1, and it's a beta\./);
  });
  it("Why I built this carries Ron's words and the sign-off", () => {
    const html = renderToStaticMarkup(createElement(WhyIBuiltThis));
    expect(html).toContain("Why I built this");
    expect(html).toContain("I started this because I couldn&#x27;t find software that worked for me.");
    expect(html).toContain("Open communication is what will make that happen.");
    expect(html).toContain("Ron Arnold, Founder");
    expect(WHY_I_BUILT_THIS).toHaveLength(2);
    expect(FOUNDER_SIGN_OFF).toBe("Ron Arnold, Founder");
  });
  it("the old 'Fast, not bloated' blurb is replaced by 'Simple on purpose'", () => {
    const html = renderToStaticMarkup(createElement(Differentiation));
    expect(html).toContain("Simple on purpose");
    expect(html).toContain("We keep cutting what you don&#x27;t need, so what&#x27;s left is what a coach does every day.");
    expect(html).not.toContain("Fast, not bloated");
    expect(html).not.toContain("buried three menus deep");
  });
  it("no faith wording was added", () => {
    const all = [BETA_BANNER, ...WHY_I_BUILT_THIS, FOUNDER_SIGN_OFF].join(" ");
    expect(all).not.toMatch(/\b(god|faith|bible|scripture|pray|prayer|lord|christ|jesus|blessed|amen)\b/i);
  });
  it("the page puts the banner at the top and the section before the final call to action, and keeps the legal links and support email", () => {
    const page = read("../../app/page.tsx");
    expect(page.indexOf("<BetaBanner />")).toBeLessThan(page.indexOf("<Hero />"));
    expect(page.indexOf("<WhyIBuiltThis />")).toBeLessThan(page.indexOf("<FinalCta />"));
    expect(page.indexOf("<Differentiation />")).toBeLessThan(page.indexOf("<WhyIBuiltThis />"));
    expect(read("./final-cta.tsx")).toContain("<LegalLinks");
  });
});
