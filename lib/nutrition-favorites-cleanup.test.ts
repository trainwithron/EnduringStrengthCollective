import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { showFavoritesTab } from "@/lib/starred-meals";
import { homeTabs, homeOfPath, type HomeFacts } from "@/lib/desktop-coach-homes";
import { NutritionClientList } from "@/components/coach/nutrition/nutrition-client-list";
import { openOwnNutritionSpace } from "@/lib/personal-space";

// Ron, Nov 21: "on the nutrition part, I still don't like the favorite meals. There's no favorite meals, built-in recipe ingredients. I don't need to see that... Why is there a search
// next to the ingredients?" And: "I'd like to see myself on the nutrition list, so I can assign myself meal plans."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const NUTRITION = "app/(coach)/groups/[groupId]/nutrition/page.tsx";

describe("the built-in recipe ingredients are a platform admin's page, not a coach's Nutrition", () => {
  it("are gone from Favorite meals", () => {
    const tab = read("components/coach/nutrition/favorite-meals-tab.tsx");
    expect(tab).not.toContain("<BuiltinIngredientMappings");
    expect(tab).not.toContain("is_platform_admin");
    expect(tab).not.toContain("Built-in recipe ingredients");
  });
  it("live on /admin/nutrition-ingredients, only for the platform admin, and nowhere else", () => {
    const page = read("app/admin/nutrition-ingredients/page.tsx");
    expect(page).toContain('if (!me?.is_platform_admin) return <NoAccess>You don&apos;t have access to this page.</NoAccess>;');
    expect(page).toContain("<BuiltinIngredientMappings initialRows={rows} />");
    const users = execSync('git grep --untracked -l "<BuiltinIngredientMappings" -- app components', { cwd: join(__dirname, ".."), encoding: "utf8" }).split("\n").filter(Boolean);
    expect(users).toEqual(["app/admin/nutrition-ingredients/page.tsx"]);
  });
  it("are linked from the admin menu (computer; on a phone Settings > Admin) and from Machine requests", () => {
    const base: HomeFacts = { groupId: "g", coachLevel: false, groupKind: "team", teamMode: false, teamSport: false, moneyHidden: false, navFacts: null, isPlatformAdmin: false, onFrontDesk: false };
    expect(homeTabs({ ...base, isPlatformAdmin: true }).settings.map((t) => t.key)).toContain("admin-ingredients");
    expect(homeTabs(base).settings.map((t) => t.key)).not.toContain("admin-ingredients");
    expect(homeOfPath("/admin/nutrition-ingredients")).toEqual({ home: "settings", tab: "admin-ingredients" });
    // not on Spotlight's Business tile (Nov 21, PH16: the phone's admin tools are in Settings > Admin)
    expect(read("components/coach/mobile/coach-spot-hub.tsx")).not.toContain("/admin/nutrition-ingredients");
    expect(read("app/admin/machine-catalog/page.tsx")).toContain('<Link href="/admin/nutrition-ingredients"');
  });
});

describe("Favorite meals shows once a meal is starred", () => {
  it("no favorites: the tabs are Clients alone, and ?tab=favorites (an old /recipes link) opens Clients", () => {
    expect(showFavoritesTab(0, false)).toBe(false);
    expect(showFavoritesTab(null, false)).toBe(false);
    expect(showFavoritesTab(3, false)).toBe(true);
    // a count that could not be read keeps the tab
    expect(showFavoritesTab(null, true)).toBe(true);
    const page = read(NUTRITION);
    expect(page).toContain('const tab = searchParams.tab === "favorites" && hasFavorites ? "favorites" : "clients";');
    expect(page).toContain('...(hasFavorites ? [{ key: "favorites" as const, label: "Favorite meals" }] : []),');
    expect(read("app/(coach)/groups/[groupId]/recipes/page.tsx")).toContain("nutrition?tab=favorites");
  });
  it("the meal plan still says how a favorite starts", () => {
    expect(read("components/coach/nutrition/client-nutrition.tsx")).toContain("star one to keep it in Favorite meals.");
  });
});

describe("the coach's own row on Nutrition", () => {
  const week = { rows: [], total: 0, failed: false };
  const athletes = [{ profileId: "c1", fullName: "Sawyer Steele", groupId: "g1" }];
  it("is first, as 'Name (you)', and opens their own nutrition", () => {
    const html = renderToStaticMarkup(createElement(NutritionClientList, { athletes, week, selectedId: null, self: { name: "Ron Arnold", href: "/groups/g/nutrition?athleteId=me" } }));
    expect(html.indexOf("Ron Arnold (you)")).toBeGreaterThan(-1);
    expect(html.indexOf("Ron Arnold (you)")).toBeLessThan(html.indexOf("Sawyer Steele"));
    expect(html).toContain('href="/groups/g/nutrition?athleteId=me"');
    expect(html).toContain("data-nutrition-self");
    const open = renderToStaticMarkup(createElement(NutritionClientList, { athletes, week, selectedId: "me", self: { name: "Ron Arnold", href: "/groups/g/nutrition?athleteId=me" } }));
    expect(open).toMatch(/data-nutrition-self=""><a [^>]*aria-current="page"/);
  });
  it("is there with no clients yet, and is never a client in the count", () => {
    const html = renderToStaticMarkup(createElement(NutritionClientList, { athletes: [], week, selectedId: null, self: { name: "Ron", href: "/x?athleteId=me" } }));
    expect(html).toContain("Ron (you)");
    expect(html).toContain("No clients yet.");
    const page = read(NUTRITION);
    expect(page).toContain("<span>All clients ({athletes.length})</span>");
    expect(page).not.toMatch(/athletes\.(push|unshift)\(/);
  });
  it("opens the personal space (made the first time, by the same database function as the program assign panel)", async () => {
    const rpcCalls: string[] = [];
    const ok = { rpc: async (name: string) => (rpcCalls.push(name), { data: "space-1", error: null }) };
    expect(await openOwnNutritionSpace(ok as never, "me")).toEqual({ groupId: "space-1", problem: null });
    expect(rpcCalls).toEqual(["ensure_personal_space"]);
    const refused = { rpc: async () => ({ data: null, error: { message: "Only coaches have a personal space." } }) };
    expect((await openOwnNutritionSpace(refused as never, "me")).problem).toBe("Only coaches have their own nutrition here.");
    expect(read("components/coach/desktop/program-assign-panel.tsx")).toContain('supabase.rpc("ensure_personal_space")');
  });
  it("saves with the coach as the athlete in their personal space, and only for the signed-in coach", () => {
    const page = read(NUTRITION);
    // only ?athleteId=<the signed-in coach> opens it: another coach's id is just "not one of your clients"
    expect(page).toContain("const wantsSelf = searchParams.athleteId === user.id;");
    expect(page).toContain("? { profileId: user.id, fullName: myName, groupId: selfSpace.groupId }");
    expect(page).toContain("const selfHref = `/groups/${params.groupId}/nutrition?athleteId=${user.id}`;");
    // the per-client view gets the space and the coach: every save it makes goes there with athlete = coach
    expect(page).toMatch(/groupId=\{selected\.groupId\}\n\s+athleteId=\{selected\.profileId\}/);
    // it stays on this page (the space has no organization to put on the top bar)
    expect(page).toContain("if (selected && !isSelf && selected.groupId !== params.groupId) {");
  });
});
