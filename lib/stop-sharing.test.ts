import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("a transformation card is shared only when the client chooses, and they can take it down", () => {
  it("the only place a card row is created is the client's own Create & share button", () => {
    const writers = ["app", "components", "lib"]
      .flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => /from\("transformation_cards"\)\s*\.insert|from\("transformation_cards"\)\s*\.upsert/.test(readFileSync(f, "utf8").replace(/\r\n/g, "\n")))
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"));
    expect(writers).toEqual(["components/athlete/transformation-card-creator.tsx"]);
  });
  it("the card's own page offers Stop sharing only to the client who made it, and it deletes the card so the link stops working", () => {
    const page = read("app/share/transformation/[cardId]/page.tsx");
    expect(page).toContain("viewerId === shared.athleteId && <StopSharingButton");
    const button = read("components/share/stop-sharing-button.tsx");
    expect(button).toContain('.from("transformation_cards").delete().eq("id", cardId)');
    expect(button).toContain("Stop sharing this card? The link will stop working for everyone.");
  });
});
