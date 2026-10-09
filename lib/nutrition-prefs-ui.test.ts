import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toggleAllergy, addOtherAllergy, DEFAULT_PREFERENCES } from "./nutrition-preferences";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("shorter food preferences, same safety", () => {
  const src = read("components/shared/food-preferences-editor.tsx");
  it("allergy buttons stay (compact), with 'Something else' and Add, still stored in allergies", () => {
    expect(src).toContain("ALLERGEN_KEYS.map");
    expect(src).toContain("h-9 px-2.5 font-body text-xs");
    expect(src).toContain("Something else (for example kiwi)");
    expect(src).toContain("set({ allergies: toggleAllergy(prefs.allergies, key) })");
  });
  it("old intolerances and dislikes show in one box and stay in their own stored fields", () => {
    expect(src).toContain("Things I don't want");
    expect(src).toContain("new Set([...prefs.intolerances, ...prefs.dislikes])");
    expect(src).toContain("allergyKeysOf([x]).size > 0");
    expect(src).toContain("intolerances: [...prefs.intolerances.filter((x) => next.includes(x)), ...freshIntolerances]");
    expect(src).not.toContain("allergies: next");
  });
  it("likes renamed, the notes box replaced by a one-line prompt on the same notes field", () => {
    expect(src).toContain('label="Things I do want"');
    expect(src).not.toContain("Foods I like");
    expect(src).toContain("Anything else we should consider?");
    expect(src).toContain("value={prefs.notes}");
  });
  it("the coach's rules are one collapsed row with the same four fields", () => {
    expect(src).toContain("<details");
    for (const f of ["dietType", "carbSplit", "proteinGPerLb", "proteinFloorGPerLb"]) expect(src).toContain(`prefs.${f}`);
    expect(src).toContain("g/lb (floor ");
  });
  it("allergy handling logic is untouched: toggling and adding still write allergies", () => {
    const p = DEFAULT_PREFERENCES;
    const on = toggleAllergy(p.allergies, "peanut");
    expect(on.some((a) => a.toLowerCase() === "peanut")).toBe(true);
    expect(addOtherAllergy(on, "kiwi").list).toContain("other: kiwi");
  });
});

describe("the Nutrition page's top bar and the client on the page agree", () => {
  const page = read("app/(coach)/groups/[groupId]/nutrition/page.tsx");
  it("picking a client opens that client's own group, and a one-on-one group shows its own client by default", () => {
    expect(page).toContain("href={`/groups/${a.groupId}/nutrition?athleteId=${a.profileId}`}");
    expect(page).toContain('group_kind === "one_on_one" ? athletes.find((a) => a.groupId === params.groupId)');
  });
});
