import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readListPanelCollapsed, writeListPanelCollapsed } from "./coach-shell-panel-storage";
import { rowMenuLinks } from "@/components/coach/desktop/client-row-menu";
import { addSessionsHref } from "./add-sessions-link";

// Ron, Nov 21: "fix all clutter and flow that arent my call". Part B, the coach app on a computer (reports/clutter-audit-nov21/desktop-DK.md). Each item's own tests sit with the
// code they changed; these cover what had none.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("DK1: a coach's Exercise library never shows the shared machine list's admin tools", () => {
  it("the page always passes isAdmin={false}; curating lives on /admin/machine-catalog (Settings > Admin)", () => {
    const page = read("app/(coach)/groups/[groupId]/exercise-library/page.tsx");
    expect(page).toContain("isAdmin={false}");
    expect(page).not.toContain("is_platform_admin");
  });
  it("the admin page curates the list directly, under the review, with the admin's powers and no Add to my gym (review of 6027ef5d)", () => {
    const admin = read("app/admin/machine-catalog/page.tsx");
    // its own admin check comes before anything is drawn
    const curateAt = admin.indexOf("<MachineCatalogCurate key=");
    expect(curateAt).toBeGreaterThan(-1);
    expect(admin.indexOf("if (!me?.is_platform_admin) return <NoAccess>")).toBeLessThan(admin.indexOf('.from("exercise_library")'));
    expect(admin.indexOf("<MachineCatalogReview requests={list} />")).toBeLessThan(curateAt);
    const curate = read("components/admin/machine-catalog-curate.tsx");
    for (const prop of ["isAdmin", "curateOnly", "machines={[]}", "orgId={null}"]) expect(curate, prop).toContain(prop);
    const section = read("components/coach/machine-catalog-section.tsx");
    expect(section).toContain("{curateOnly ? null : inGym.has(m.id) ? (");
    expect(section).toContain("{isAdmin && !curateOnly && (");
  });
  it("the admin's own demos are offered there ('Or use one of my demos'), and the review and the list refresh each other (re-review of 8026dee8)", () => {
    const admin = read("app/admin/machine-catalog/page.tsx");
    expect(admin).toContain('.select("id, name, video_path, youtube_url").eq("created_by", user.id)');
    expect(admin).toContain('<MachineCatalogCurate key={list.map((r) => r.id).join(",")} adminId={user.id} library={myLibrary} />');
    const curate = read("components/admin/machine-catalog-curate.tsx");
    expect(curate).not.toContain("library={[]}");
    expect(curate).toContain("library={library}");
    expect(curate).toContain("onListChanged={() => router.refresh()}");
    const section = read("components/coach/machine-catalog-section.tsx");
    expect(section).toContain("await Promise.all([reload(), loadRequests()]);\n    onListChanged?.();");
    expect(section).toContain("await reload();\n                      onListChanged?.();");
  });
});

describe("DK5: the folded panels are never out of reach", () => {
  it("the fold has its own toggle whenever any panel in it drew something, as well as N more and a notice's #link", () => {
    const fold = read("components/coach/desktop/needs-stack-fold.tsx");
    expect(fold).toContain('export const SHOW_STACK_LABEL = "Show everything else";');
    expect(fold).toContain("{hasContent && (");
    expect(fold).toContain("{open ? HIDE_STACK_LABEL : SHOW_STACK_LABEL}");
    expect(fold).toContain("observer.observe(ref.current, { childList: true, subtree: true, characterData: true });");
    expect(fold).toContain('window.addEventListener("hashchange", fromHash);');
    expect(fold).toContain("window.addEventListener(NEEDS_STACK_EVENT, onMore);");
  });
});

describe("DK4: the closed panel's open button is big enough to hit", () => {
  it("24 wide by 44 tall", () => {
    const panel = read("components/coach/desktop/shell-list-panel.tsx");
    const collapsed = panel.slice(panel.indexOf("if (collapsed) {"), panel.indexOf('aria-label="Expand panel"') + 400);
    expect(collapsed).toContain('className="w-6 h-11 mt-3');
  });
});

describe("DK2: Plan & Billing", () => {
  it("shows on the organization's page only once billing is switched on; the platform admin previews it from Settings > Admin", () => {
    const page = read("app/(coach)/groups/[groupId]/branding/page.tsx");
    expect(page).toContain('const showPlanTab = isBillingEnforced() || (viewerProfile?.is_platform_admin === true && searchParams.preview === "1");');
    expect(read("lib/desktop-coach-homes.ts")).toContain('f.isPlatformAdmin && { key: "admin-billing", label: "Billing preview", href: `${g}/branding?tab=billing&preview=1`, group: ADMIN }');
  });
});

describe("DK4: the side panel starts closed", () => {
  const store = new Map<string, string>();
  const fakeWindow = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });
  it("closed for anyone who never chose; a coach who opened it keeps it open; one who closed it keeps it closed", () => {
    vi.stubGlobal("window", fakeWindow);
    expect(readListPanelCollapsed()).toBe(true);
    writeListPanelCollapsed(false);
    expect(readListPanelCollapsed()).toBe(false);
    writeListPanelCollapsed(true);
    expect(readListPanelCollapsed()).toBe(true);
  });
  it("closed when the browser's storage cannot be read", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); } } });
    expect(readListPanelCollapsed()).toBe(true);
  });
  it("the panel's own strip is left off Home, where Needs you is the one list (DK5)", () => {
    const panel = read("components/coach/desktop/shell-list-panel.tsx");
    expect(panel).toContain('const onHome = usePathname() === "/dashboard";');
    expect(panel).toContain("{!onHome && (");
    expect(panel).toContain("useState(true);");
  });
});

describe("DK6: nothing flagged shows nothing", () => {
  it("no tips, ideas or fun facts in the side panel's strip", () => {
    const strip = read("components/coach/desktop/needs-attention-strip.tsx");
    for (const filler of ["Business tip", "Revenue idea", "Did you know", "pickIdleSlotContent", "idleContent"]) expect(strip, filler).not.toContain(filler);
    expect(strip).toContain("if (!items || items.length === 0) return null;");
  });
});

describe("DK13: Organization > Team puts the team first", () => {
  it("members and the invite come before the marketplace and Coach Dispatch; the slug and created date are gone", () => {
    const page = read("app/(coach)/groups/[groupId]/branding/page.tsx");
    const team = page.slice(page.indexOf('{tab === "team" ? ('), page.indexOf(') : tab === "labels" ? ('));
    const at = (s: string) => team.indexOf(s);
    expect(at("<TeamMembersPanel")).toBeGreaterThan(-1);
    expect(at("<TeamMembersPanel")).toBeLessThan(at("<InviteCoachForm"));
    expect(at("<InviteCoachForm")).toBeLessThan(at("<MarketplaceListingToggle"));
    expect(at("<MarketplaceListingToggle")).toBeLessThan(at('<OrgSection title="Coach Dispatch">'));
    expect(team).not.toContain("/{org?.slug}");
    expect(team).not.toContain("Created {org?.created_at");
    expect(page).not.toContain("eventually billing");
  });
});

describe("DK19, DK20: the program builder", () => {
  const builder = read("components/coach/desktop/program-builder-desktop.tsx");
  it("the weeks start under the name and one toolbar: description, progressions, the AI box, intent, the chat and the schedule are one Program settings fold", () => {
    const fold = builder.slice(builder.indexOf("data-program-settings>"), builder.indexOf("</details>"));
    for (const part of ["<ProgramDescriptionEditor", "<ProgramProgressionPanel", "<AiProgramBuilderBox", "<TrainingIntentSelector", "<ProgramChatPanel", "<ProgramScheduleSettings"]) expect(fold, part).toContain(part);
    expect(builder.indexOf("</details>")).toBeLessThan(builder.indexOf("<WeekGrid"));
    // open only on a program with no weeks, read once
    expect(builder).toContain("const [settingsOpenAtStart] = useState(initialDays.length === 0);");
  });
  it("opens on the latest week, and Add week sits above the weeks", () => {
    expect(builder).toContain("return new Set(weekNumbers.length > 0 ? [Math.max(...weekNumbers)] : []);");
    expect(builder.indexOf("+ Add Week {nextWeekNumber}")).toBeLessThan(builder.indexOf("<WeekGrid"));
    expect(builder.match(/\+ Add Week \{nextWeekNumber\}/g)?.length).toBe(1);
  });
});

describe("DK26: the clients row menu leads with the everyday jobs", () => {
  it("Log workout, Book session, Message and Add sessions, each to the place that does it", () => {
    expect(rowMenuLinks("g1", "a1")).toEqual([
      { label: "Log workout", href: "/groups/g1/athletes/a1/log" },
      { label: "Book session", href: "/calendar?view=week&client=a1" },
      { label: "Message", href: "/groups/g1/messages?with=a1" },
      { label: "Add sessions", href: addSessionsHref("g1", "a1") },
    ]);
  });
  it("they come first, and Delete permanently is last, set apart", () => {
    const menu = read("components/coach/desktop/client-row-menu.tsx");
    const body = menu.slice(menu.indexOf('<div role="menu"'));
    expect(body.indexOf("rowMenuLinks(groupId, athleteId)")).toBeLessThan(body.indexOf("Client type"));
    expect(body.indexOf("Remove from my")).toBeLessThan(body.indexOf('border-t border-steel/30 mt-2 mb-0.5'));
    expect(body.indexOf('border-t border-steel/30 mt-2 mb-0.5')).toBeLessThan(body.indexOf("permanently"));
  });
});

describe("DK29: money on the Business tab only", () => {
  it("no MRR or income tile on Home for anyone, no money hover on the rail, and the shop and referral clicks are one small line", () => {
    const home = read("app/(coach)/dashboard/page.tsx");
    expect(home).toContain('tiles={dashboardData.statTiles.tiles.filter((x) => x.key !== "mrr" && x.key !== "income")}');
    expect(read("components/coach/coach-desktop-shell.tsx")).not.toContain("BusinessRailWidget");
    const biz = read("app/(coach)/groups/[groupId]/business/page.tsx");
    expect(biz).toContain("data-shop-referrals");
    expect(biz).not.toContain(">Referral clicks<");
    expect(biz).not.toContain(">Pro Shop clicks<");
  });
});

describe("DK12: no 'not switched on yet'", () => {
  it("the program label control is simply not shown before its step, and check-ins say what is true", () => {
    expect(read("components/coach/program-role-control.tsx")).toContain("if (!available) return null;");
    expect(read("components/coach/program-role-control.tsx")).not.toContain("Labels for programs (Main, Mobility, Warm-up) are not switched on yet.");
    expect(read("app/(coach)/clients/check-ins/page.tsx")).not.toContain("switched on yet");
  });
});
