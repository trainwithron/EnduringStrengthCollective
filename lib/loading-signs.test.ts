import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Ron, Oct 19: "some of the pages are missing loading signs. So you'll tap something and you'll just assume it's unresponsive because nothing happens."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("a tap always shows something is happening", () => {
  const bar = read("components/shared/nav-progress.tsx");
  it("the thin bar is in the root layout, in its own Suspense, so every page has it", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("<Suspense fallback={null}>\n          <NavProgress />\n        </Suspense>");
  });
  it("it starts on a click on a link to another page of the app, before anything else handles the click", () => {
    expect(bar).toContain('document.addEventListener("click", onClick, true);');
    expect(bar).toContain("if (url.origin !== window.location.origin) return;");
    expect(bar).toContain("if (url.pathname === window.location.pathname && url.search === window.location.search) return;");
  });
  it("not for a modified click, a new tab, a download or a jump within the page", () => {
    expect(bar).toContain("e.metaKey || e.ctrlKey || e.shiftKey || e.altKey");
    expect(bar).toContain('if (a.target && a.target !== "_self") return;');
    expect(bar).toContain('if (a.hasAttribute("download")) return;');
    expect(bar).toContain('if (!href || href.startsWith("#")) return;');
  });
  it("it goes when the new page is there, or after 15 seconds; it keeps clear of the split screen and is not a loading screen", () => {
    expect(bar).toContain("}, [pathname, searchParams]);");
    expect(bar).toContain("setTimeout(() => setActive(false), 15000)");
    expect(bar).toContain('style={{ left: "var(--split-reserved, 0px)" }}');
    expect(bar).toContain('background: "rgb(var(--rust))"');
    expect(bar).not.toContain("data-loading-fallback");
  });
});

describe("the slow pages show a loading screen at once", () => {
  for (const dir of ["app/(coach)/programs", "app/(coach)/clients", "app/(coach)/dashboard", "app/notifications", "app/my-training"]) {
    it(dir, () => {
      expect(existsSync(join(__dirname, "..", dir, "loading.tsx"))).toBe(true);
      const page = read(`${dir}/loading.tsx`);
      expect(page).toContain("<main data-loading-fallback");
      expect(page).toContain("<LoadingTip />");
    });
  }
});
