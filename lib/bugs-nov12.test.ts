import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
function tsxFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(root, p)).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("Nov 12 bugs (Ron)", () => {
  it("the group leaderboard counts only the people in the group now (a member who left showed as #1 Unknown)", () => {
    const s = read("lib/leaderboard-data.ts");
    expect(s).toContain("readPositionRoster(supabase, groupId)");
    expect(s).toContain("if (!counts(id, log.profiles)) continue;");
    expect(s).toContain("if (!counts(id, shared.fullName)) continue;");
  });
  it("the act-as bar is decided on the server: with no act-as setting it is the coach's own space, so no Back to me bar on their own feed", () => {
    const bar = read("components/athlete/acting-as-bar.tsx");
    expect(bar).toContain('jar.get(ACTING_AS_SELF_COOKIE)?.value === "1" || !jar.get(ACTING_AS_COOKIE)?.value');
    // Every server page uses the server bar, never the bare client one.
    for (const f of [...tsxFiles("app"), ...tsxFiles("components")]) {
      if (f.endsWith("acting-as-bar.tsx")) continue;
      expect(read(f), f).not.toContain('from "@/components/athlete/acting-as-banner"');
    }
  });
});
