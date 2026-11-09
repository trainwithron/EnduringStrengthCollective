import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canShareWorkouts, coachLabel, loadSharedGroupOffer, pickSharedGroup, removeSharedWorkoutCards, sharedFeedGroupFor, type SharedGroupCandidate } from "@/lib/shared-group-join";
import { postToSharedGroups } from "@/lib/announce-workout-log";
import { sharedWorkoutCardsFromPosts } from "@/lib/leaderboard-data";
import { pickStartGroup } from "@/lib/start-group";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// A small stand-in for the database client: every query is answered by `answer(table, filters, op)`; writes are recorded.
type Filters = Record<string, unknown>;
function fakeDb(answer: (table: string, filters: Filters, op: string, select: string) => { data: unknown; error: unknown }) {
  const writes: Array<{ table: string; op: string; payload?: unknown; filters: Filters }> = [];
  const from = (table: string) => {
    const filters: Filters = {};
    let op = "select";
    let select = "";
    let payload: unknown;
    const b: any = {
      select: (s: string) => {
        if (op === "select") select = s;
        return b;
      },
      insert: (p: unknown) => {
        op = "insert";
        payload = p;
        return b;
      },
      update: (p: unknown) => {
        op = "update";
        payload = p;
        return b;
      },
      delete: () => {
        op = "delete";
        return b;
      },
      eq: (k: string, v: unknown) => ((filters[k] = v), b),
      in: (k: string, v: unknown) => ((filters[`in:${k}`] = v), b),
      not: (k: string, _o: string, v: unknown) => ((filters[`not:${k}`] = v), b),
      order: () => b,
      limit: () => b,
      maybeSingle: () => finish(),
      single: () => finish(),
      then: (res: any, rej: any) => finish().then(res, rej),
    };
    const finish = () => {
      if (op !== "select") writes.push({ table, op, payload, filters: { ...filters } });
      return Promise.resolve(answer(table, filters, op, select));
    };
    return b;
  };
  return { db: { from } as any, writes };
}

const g = (over: Partial<SharedGroupCandidate>): SharedGroupCandidate => ({ id: "g", name: "G", group_kind: "team", team_mode: false, archived_at: null, ...over });

describe("which shared group is offered", () => {
  it("exactly one team or social group that is not a team-sport roster and not retired", () => {
    expect(pickSharedGroup([g({ id: "a", group_kind: "one_on_one" }), g({ id: "b" })])?.id).toBe("b");
    expect(pickSharedGroup([g({ id: "s", group_kind: "social" })])?.id).toBe("s");
  });
  it("none, or several: nothing is offered", () => {
    expect(pickSharedGroup([])).toBeNull();
    expect(pickSharedGroup([g({ id: "a", team_mode: true }), g({ id: "b", archived_at: "2026-01-01" }), g({ id: "c", group_kind: "one_on_one" })])).toBeNull();
    expect(pickSharedGroup([g({ id: "a" }), g({ id: "b", group_kind: "social" })])).toBeNull();
  });
});

describe("the words", () => {
  it("Coach and the coach's first name", () => {
    expect(coachLabel("Ron Arnold")).toBe("Coach Ron");
    expect(coachLabel("  ")).toBe("your coach");
    expect(coachLabel(null)).toBe("your coach");
  });
  it("the card is Ron's wording, with both buttons and Not now", () => {
    const card = read("components/athlete/shared-group-join-card.tsx");
    for (const line of [
      "Join {groupName}",
      "Our group of clients training together. You&apos;ll get:",
      "Announcements from {coachName}, like schedule changes",
      "The group chat and PR board",
      "The leaderboard, if you want to compete",
      "Encouragement from people putting in the work",
      "Join and share my workouts",
      "Join, but keep my workouts private",
      "Not now",
    ]) {
      expect(card).toContain(line);
    }
    // the share button only when sharing is allowed (not for a client under 18)
    expect(card).toContain("{allowShare && (");
    expect(card).toContain("NOT_NOW_DAYS = 30");
  });
});

describe("under 18", () => {
  const asOf = new Date("2026-11-09T12:00:00Z");
  it("a client under 18 cannot share; an adult, or no date on file, can", () => {
    expect(canShareWorkouts("2010-05-01", asOf)).toBe(false);
    expect(canShareWorkouts("1990-05-01", asOf)).toBe(true);
    expect(canShareWorkouts(null, asOf)).toBe(true);
  });
});

describe("the offer", () => {
  const base = (over: { seatRole?: string; already?: boolean; columnMissing?: boolean; dob?: string | null; groups?: SharedGroupCandidate[]; kind?: string }) =>
    fakeDb((table, f, _op, select) => {
      if (table === "groups" && f.id === "space") return { data: { id: "space", organization_id: "org", group_kind: over.kind ?? "one_on_one", archived_at: null }, error: null };
      if (table === "groups" && f.organization_id === "org") return { data: over.groups ?? [g({ id: "shared", name: "The Enduring Strength Collective" })], error: null };
      if (table === "group_memberships" && select === "shares_workouts") return over.columnMissing ? { data: null, error: { message: "column does not exist" } } : { data: [], error: null };
      if (table === "group_memberships" && f.group_id === "space" && f.role === "coach") return { data: { profiles: { full_name: "Ron Arnold" } }, error: null };
      if (table === "group_memberships" && f.group_id === "space") return { data: over.seatRole === undefined ? { role: "athlete" } : over.seatRole ? { role: over.seatRole } : null, error: null };
      if (table === "group_memberships" && f.group_id === "shared") return { data: over.already ? { id: "m" } : null, error: null };
      if (table === "client_intake") return { data: { date_of_birth: over.dob ?? null }, error: null };
      return { data: null, error: null };
    });

  it("a client in their one-on-one space gets the group, the coach's name, and the share button", async () => {
    const { db } = base({});
    expect(await loadSharedGroupOffer(db, "me", "space")).toEqual({ groupId: "shared", groupName: "The Enduring Strength Collective", coachName: "Coach Ron", allowShare: true });
  });
  it("under 18: only the private join", async () => {
    const { db } = base({ dob: "2011-01-01" });
    expect((await loadSharedGroupOffer(db, "me", "space"))?.allowShare).toBe(false);
  });
  it("nothing for a coach, someone not in the space, someone already in the group, a group space, several groups, or before step 202", async () => {
    expect(await loadSharedGroupOffer(base({ seatRole: "coach" }).db, "me", "space")).toBeNull();
    expect(await loadSharedGroupOffer(base({ seatRole: "" }).db, "me", "space")).toBeNull();
    expect(await loadSharedGroupOffer(base({ already: true }).db, "me", "space")).toBeNull();
    expect(await loadSharedGroupOffer(base({ kind: "team" }).db, "me", "space")).toBeNull();
    expect(await loadSharedGroupOffer(base({ groups: [g({ id: "a" }), g({ id: "b" })] }).db, "me", "space")).toBeNull();
    expect(await loadSharedGroupOffer(base({ columnMissing: true }).db, "me", "space")).toBeNull();
  });
});

describe("finishing a workout posts to the shared group the client shares with", () => {
  const seats = (rows: unknown[], existing: string[] = []) =>
    fakeDb((table, f, op) => {
      if (table === "group_memberships") return { data: rows, error: null };
      if (table === "posts" && op === "select") return { data: existing.includes(f.group_id as string) ? { id: "old" } : null, error: null };
      if (table === "posts" && op === "insert") return { data: { id: "new" }, error: null };
      return { data: null, error: null };
    });
  const input = { workoutLogId: "log", athleteId: "me", groupId: "space", hasPrs: true };

  it("one card, in the PR Board for a workout with a PR, by the client", async () => {
    const { db, writes } = seats([{ group_id: "shared", groups: { post_workout_cards: null, team_mode: false } }]);
    expect(await postToSharedGroups(db, { ...input, broadcastLevel: "full" })).toEqual(["new"]);
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ group_id: "shared", author_id: "me", post_type: "workout_summary", workout_log_id: "log", channel: "pr_board", broadcast_level: "full" });
  });
  it("only seats with sharing on are read", async () => {
    const { db } = fakeDb((table, f) => {
      if (table === "group_memberships") {
        expect(f).toMatchObject({ profile_id: "me", role: "athlete", membership_type: "social_only", shares_workouts: true });
      }
      return { data: [], error: null };
    });
    expect(await postToSharedGroups(db, { ...input, broadcastLevel: "full" })).toEqual([]);
  });
  it("check-in only goes to General; private and a prs-only workout with no PR post nothing", async () => {
    const a = seats([{ group_id: "shared", groups: null }]);
    await postToSharedGroups(a.db, { ...input, broadcastLevel: "checkin_only" });
    expect((a.writes[0].payload as { channel: string }).channel).toBe("general");
    const b = seats([{ group_id: "shared", groups: null }]);
    expect(await postToSharedGroups(b.db, { ...input, broadcastLevel: "private" })).toEqual([]);
    expect(await postToSharedGroups(b.db, { ...input, hasPrs: false, broadcastLevel: "prs_only" })).toEqual([]);
    expect(b.writes).toHaveLength(0);
  });
  it("not twice, not in a group with cards switched off, never back into the workout's own group, nothing before step 202", async () => {
    const twice = seats([{ group_id: "shared", groups: null }], ["shared"]);
    expect(await postToSharedGroups(twice.db, { ...input, broadcastLevel: "full" })).toEqual([]);
    const off = seats([{ group_id: "shared", groups: { post_workout_cards: false } }]);
    expect(await postToSharedGroups(off.db, { ...input, broadcastLevel: "full" })).toEqual([]);
    const own = seats([{ group_id: "space", groups: null }]);
    expect(await postToSharedGroups(own.db, { ...input, broadcastLevel: "full" })).toEqual([]);
    const before = fakeDb(() => ({ data: null, error: { message: "column group_memberships.shares_workouts does not exist" } }));
    expect(await postToSharedGroups(before.db, { ...input, broadcastLevel: "full" })).toEqual([]);
  });
  it("the workout's own card is looked up in its own group, so a shared-group card never stands in for it", () => {
    expect(read("lib/announce-workout-log.ts")).toContain('.eq("post_type", "workout_summary").eq("group_id", groupId).maybeSingle()');
    expect(read("components/session/complete-workout-button.tsx")).toContain('.eq("group_id", existingSession.group_id)');
    expect(read("components/session/complete-workout-button.tsx")).toContain("skipSharedGroups: !!coachMode?.clientIsMinor");
  });
});

describe("the shared group's leaderboard", () => {
  it("counts a sharing client's shared workouts once each, never a card whose author did not do the workout, never the group's own workouts twice", () => {
    const rows = [
      { author_id: "a", workout_log_id: "l1", workout_logs: { athlete_id: "a", group_id: "space-a", total_volume: 1000, new_prs: ["Squat"] }, profiles: { full_name: "Ann Lee", feed_broadcast_level: "full" } },
      { author_id: "a", workout_log_id: "l1", workout_logs: { athlete_id: "a", group_id: "space-a", total_volume: 1000, new_prs: ["Squat"] }, profiles: { full_name: "Ann Lee", feed_broadcast_level: "full" } },
      { author_id: "coach", workout_log_id: "l2", workout_logs: { athlete_id: "b", group_id: "space-b", total_volume: 50, new_prs: [] }, profiles: null },
      { author_id: "c", workout_log_id: "l3", workout_logs: { athlete_id: "c", group_id: "shared", total_volume: 70, new_prs: [] }, profiles: null },
      { author_id: "d", workout_log_id: "l4", workout_logs: null, profiles: null },
    ];
    expect(sharedWorkoutCardsFromPosts("shared", rows)).toEqual([{ athleteId: "a", fullName: "Ann Lee", broadcastLevel: "full", totalVolume: 1000, prCount: 1 }]);
  });
  it("the board reads those cards, with the same sharing-level rule", () => {
    const src = read("lib/leaderboard-data.ts");
    expect(src).toContain("for (const shared of await readSharedWorkoutCards(supabase, groupId))");
    expect(src).toContain("if (!onSharedBoards(shared.broadcastLevel)) continue;");
  });
});

describe("turning sharing off, or leaving", () => {
  it("takes off only the cards of workouts from the client's own space", async () => {
    const { db, writes } = fakeDb((table, _f, op) => {
      if (table === "posts" && op === "select")
        return { data: [{ id: "p1", workout_logs: { group_id: "space" } }, { id: "p2", workout_logs: { group_id: "shared" } }], error: null };
      return { data: null, error: null };
    });
    expect(await removeSharedWorkoutCards(db, "shared", "me")).toBe(true);
    expect(writes).toEqual([{ table: "posts", op: "delete", payload: undefined, filters: { "in:id": ["p1"] } }]);
  });
});

describe("the join route", () => {
  const route = read("app/api/shared-group/route.ts");
  it("only the signed-in person's own seat, only social-only athlete, only the offered group, only after step 202", () => {
    expect(route).toContain('if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });');
    expect(route).toContain("const offer = await loadSharedGroupOffer(db, user.id, body.spaceGroupId);");
    expect(route).toContain('insert({ group_id: offer.groupId, profile_id: user.id, role: "athlete", membership_type: "social_only", shares_workouts: share })');
    expect(route).toContain("if (share && !offer.allowShare)");
    expect(route).toContain('.eq("profile_id", user.id).eq("role", "athlete").eq("membership_type", "social_only")');
    expect(route).toContain("if (!(await sharingColumnReady(db)))");
  });
  it("is a save the other panes hear about", () => {
    expect(read("lib/workspace-mutation.ts")).toContain("|shared-group|");
  });
});

describe("the database update (step 202)", () => {
  const sql = read("supabase/migrations/0447_shared_group_join.sql");
  it("is idempotent and matches the paste", () => {
    expect(sql).toContain("add column if not exists shares_workouts boolean not null default false");
    expect(sql).toContain("drop trigger if exists group_memberships_guard_shares_workouts");
    expect(sql).toContain('drop policy if exists "workout_logs_select_shared_card"');
    expect(read("supabase/apply/apply-step202-0447.sql")).toContain(sql.trim());
  });
  it("a coach cannot switch a client's sharing; members read only cards of clients sharing with them", () => {
    expect(sql).toContain("if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then");
    expect(sql).toContain("and wl.athlete_id = sm.profile_id");
    expect(sql).toContain("where sm.shares_workouts");
    expect(sql).toContain("revoke all on function public.my_shared_card_workout_log_ids() from public, anon;");
  });
});

describe("a social-only seat is not where a client trains", () => {
  it("a client who never logged lands in their own space, not the shared group they joined later", () => {
    const picked = pickStartGroup({
      memberships: [
        { group_id: "space", role: "athlete", joined_at: "2026-01-01", group_kind: "one_on_one", membership_type: "training" },
        { group_id: "shared", role: "athlete", joined_at: "2026-11-09", group_kind: "team", membership_type: "social_only" },
      ],
      lastGroupId: "shared",
    });
    expect(picked?.group_id).toBe("space");
  });
  it("the Feed tab of their own space shows the shared group's feed", async () => {
    const { db } = fakeDb(() => ({ data: [{ group_id: "shared", groups: { name: "The Collective", organization_id: "org", group_kind: "team", archived_at: null } }], error: null }));
    expect(await sharedFeedGroupFor(db, "me", "org")).toBe("shared");
    expect(await sharedFeedGroupFor(db, "me", null)).toBeNull();
    expect(read("app/(coach)/groups/[groupId]/feed/page.tsx")).toContain("if (joinedGroupId) feedGroupId = joinedGroupId;");
  });
  it("its programs are not listed as theirs, and it is not another coach", () => {
    expect(read("lib/my-training.ts")).toContain('membership_type !== "social_only"');
    expect(read("lib/your-coaches.ts")).toContain('.eq("membership_type", "training")');
  });
});

describe("Home and Settings", () => {
  it("the card shows only once the goal sheet is done, for the client themselves", () => {
    const home = read("app/(coach)/groups/[groupId]/page.tsx");
    expect(home).toContain('if (!sheetError && !goalSheetNeeded && user && athleteId === user.id && (group as { group_kind?: string }).group_kind === "one_on_one")');
    expect(home).toContain("{isToday && !goalSheetNeeded && sharedGroupOffer && (");
  });
  it("Settings has the on/off and Leave", () => {
    const s = read("components/athlete/shared-group-settings.tsx");
    expect(s).toContain("Share my workouts with {groupName}");
    expect(s).toContain("Leave {groupName}");
  });
});
