import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Ron, Nov 23 (screenshot, logging for a client): "Box opens wrong way". A long exercise name wraps and puts ⋯ at the left edge, where the menu (anchored right) ran off the screen.
describe("logger: the exercise ⋯ menu opens toward the side with room", () => {
  const src = readFileSync(new URL("../components/logging/exercise-card.tsx", import.meta.url), "utf8");
  it("works out the side from where the button is when it opens", () => {
    expect(src).toContain("const [menuOpensRight, setMenuOpensRight] = useState(false);");
    expect(src).toMatch(/getBoundingClientRect\(\);\s*setMenuOpensRight\(!!r && typeof window !== "undefined" && r\.left \+ r\.width \/ 2 < window\.innerWidth \/ 2\);/);
  });
  it("anchors left when the button is on the left half, right otherwise, and never wider than the screen", () => {
    expect(src).toContain('${menuOpensRight ? "left-0" : "right-0"} top-full');
    expect(src).toContain("max-w-[calc(100vw-2rem)]");
    expect(src).not.toContain('className="absolute right-0 top-full z-20');
  });
});
