import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadShareIdentity } from "@/lib/share-identity";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

// A stand-in database: each table answers with one row (or an error for the profile read that asks for the new column).
function fakeDb(rows: Record<string, unknown>, opts: { noNameColumn?: boolean } = {}) {
  return {
    from(table: string) {
      let columns = "";
      const q: any = {
        select(c: string) {
          columns = c;
          return q;
        },
        eq() {
          return q;
        },
        async maybeSingle() {
          if (table === "profiles" && opts.noNameColumn && columns.includes("show_name_on_share")) return { data: null, error: { message: "column does not exist" } };
          return { data: rows[table] ?? null, error: null };
        },
      };
      return q;
    },
  } as any;
}

const adultDob = "1990-05-05";
const teenDob = new Date(Date.now() - 15 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);

describe("loadShareIdentity: what a stranger sees on a milestone or transformation card", () => {
  it("shows first name and last initial when the client has not hidden it (adult)", async () => {
    const id = await loadShareIdentity(fakeDb({ profiles: { full_name: "Alice Anderson", show_name_on_share: null }, groups: { name: "Team", group_kind: "team" }, client_intake: { date_of_birth: adultDob } }), "a", "g");
    expect(id.athleteName).toBe("Alice A.");
    expect(id.groupName).toBe("Team");
    expect(id.isMinor).toBe(false);
  });
  it("shows no name when the client switched it off", async () => {
    const id = await loadShareIdentity(fakeDb({ profiles: { full_name: "Alice Anderson", show_name_on_share: false }, groups: { name: "Team", group_kind: "team" }, client_intake: { date_of_birth: adultDob } }), "a", "g");
    expect(id.athleteName).toBe("An athlete");
  });
  it("shows no name by default under 18, and says so", async () => {
    const id = await loadShareIdentity(fakeDb({ profiles: { full_name: "Tim Teen", show_name_on_share: null }, groups: { name: "Team", group_kind: "team" }, client_intake: { date_of_birth: teenDob } }), "a", "g");
    expect(id.athleteName).toBe("An athlete");
    expect(id.isMinor).toBe(true);
  });
  it("uses the business name for a one-on-one space (which is named after the client)", async () => {
    const id = await loadShareIdentity(
      fakeDb({ profiles: { full_name: "Alice Anderson", show_name_on_share: true }, groups: { name: "Alice Anderson", organization_id: "o", group_kind: "one_on_one" }, organizations: { name: "Ron Strength" }, client_intake: null }),
      "a",
      "g"
    );
    expect(id.groupName).toBe("Ron Strength");
    expect(id.groupName).not.toContain("Alice");
  });
  it("before the name column exists, the name still shows as it always did", async () => {
    const id = await loadShareIdentity(fakeDb({ profiles: { full_name: "Alice Anderson" }, groups: { name: "Team", group_kind: "team" }, client_intake: null }, { noNameColumn: true }), "a", "g");
    expect(id.athleteName).toBe("Alice A.");
  });
});

describe("the public cards and the feed use it", () => {
  it("milestone and transformation cards resolve names through it and show nothing for a minor", () => {
    for (const f of ["lib/shared-milestone.ts", "lib/shared-transformation-card.ts"]) {
      const src = read(f);
      expect(src).toContain("loadShareIdentity(supabase");
      expect(src).toContain("if (identity.isMinor) return null;");
      expect(src).not.toContain('.select("full_name")');
    }
  });
  it("a card's photo is only signed when it is the card owner's own", () => {
    const src = read("lib/shared-transformation-card.ts");
    expect(src.match(/\.eq\("athlete_id", card\.athlete_id\)/g)?.length).toBe(2);
  });
  it("both card pages are kept out of search engines", () => {
    expect(read("app/share/milestone/[milestoneId]/page.tsx")).toContain("index: false");
    expect(read("app/share/transformation/[cardId]/page.tsx")).toContain("index: false");
  });
  it("no card can be made for a client under 18", () => {
    expect(read("app/(coach)/groups/[groupId]/transformation/new/page.tsx")).toContain("athleteIsMinor(supabase, user.id)");
    expect(read("supabase/migrations/0339_transformation_cards_ownership.sql")).toContain("interval '18 years'");
  });
  it("the feed's exported picture uses the public names, and only the author or coach can share", () => {
    const card = read("components/feed/workout-card-expanded.tsx");
    expect(card).toContain("exporting ? data.publicAthleteName : data.athleteName");
    expect(card).toContain("exporting ? data.publicGroupName : data.groupName");
    expect(card).toContain("{data.canShare && (");
    const route = read("app/api/workout-share/[postId]/route.ts");
    expect(route).toContain("canShare");
    const summary = read("components/feed/workout-summary-card.tsx");
    expect(summary).toContain("(isCoach || viewerId === post.author.id)");
    expect(summary).toContain('title="Just finished a workout! 💪"');
    expect(summary).not.toContain("post.author.fullName} just finished");
  });
  it("the coach congrats line uses the author's own first name, not the public placeholder", () => {
    const page = read("app/share/[postId]/page.tsx");
    expect(page).toContain("athleteFirstName: firstNameOf(ownProfile?.full_name)");
    expect(page).not.toContain("firstNameOf(shared.athleteName)");
  });
});
