import { describe, it, expect } from "vitest";
import { exportEntries, EXPORT_FILES } from "./business-export";

// A fake database: tables of rows; .select().in(col, ids).order().range() filters and slices like PostgREST.
function fakeDb(tables: Record<string, any[]>, opts: { failTable?: string } = {}) {
  return {
    from(table: string) {
      let rows = tables[table] ?? [];
      const q: any = {
        select: () => q,
        in: (col: string, ids: string[]) => {
          rows = rows.filter((r) => ids.includes(r[col]));
          return q;
        },
        order: () => q,
        range: (from: number, to: number) => {
          if (opts.failTable === table) return Promise.resolve({ data: null, error: { message: "boom" } });
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return q;
    },
  };
}

async function run(tables: Record<string, any[]>, opts: { failTable?: string; groupIds?: string[] } = {}) {
  const files = new Map<string, string>();
  for await (const e of exportEntries({
    supabase: fakeDb(tables, opts),
    groupIds: opts.groupIds ?? ["g1", "g2"],
    orgName: "Iron Works",
    emailsFor: async () => new Map([["c1", "jane@example.com"]]),
    now: new Date("2026-10-17T12:00:00Z"),
  })) {
    let text = "";
    for await (const c of e.chunks) text += new TextDecoder("utf-8", { ignoreBOM: true }).decode(c);
    files.set(e.name, text);
  }
  return files;
}

const base = () => ({
  groups: [
    { id: "g1", name: "Morning Crew", group_kind: "team" },
    { id: "g2", name: "Jane Smith", group_kind: "one_on_one" },
  ],
  group_memberships: [
    { id: "m1", group_id: "g1", profile_id: "c1", role: "athlete", joined_at: "2026-01-01" },
    { id: "m2", group_id: "g1", profile_id: "coach", role: "coach" },
    { id: "m3", group_id: "g2", profile_id: "c2", role: "athlete" },
  ],
  profiles: [
    { id: "c1", full_name: "Jane Smith", claimed_at: "2026-01-02" },
    { id: "c2", full_name: "Bob, Jr.", claimed_at: null },
  ],
  athlete_sessions: [{ id: "s1", group_id: "g1", athlete_id: "c1", completed_at: "2026-02-01T10:00:00Z" }],
  session_exercises: [{ id: "e1", session_id: "s1", exercise_name: "Back Squat" }],
  set_logs: [{ id: "l1", session_exercise_id: "e1", set_order: 0, weight: 225, reps: 5 }],
});

describe("exportEntries", () => {
  it("makes every promised file, with clients, emails, and sets joined to their workout and exercise", async () => {
    const files = await run(base());
    for (const f of EXPORT_FILES) expect(files.has(f.file), f.file).toBe(true);
    expect(files.has("README.txt")).toBe(true);
    expect(files.get("clients.csv")).toContain("Jane Smith,jane@example.com,Morning Crew,team");
    expect(files.get("clients.csv")).toContain('"Bob, Jr."');
    expect(files.get("clients.csv")).toContain(",no\r\n");
    const sets = files.get("sets_logged.csv")!.split("\r\n");
    expect(sets[1]).toContain("s1,c1,g1,2026-02-01T10:00:00Z,Back Squat,0,,225,5");
    expect(files.get("export-status.txt")).toMatch(/^COMPLETE/);
    expect(files.get("export-status.txt")).toContain("sets_logged.csv: 1 rows");
  });

  it("a table that could not be read is named in the status file, never silently empty", async () => {
    const files = await run(base(), { failTable: "bookings" });
    expect(files.get("export-status.txt")).toMatch(/^INCOMPLETE: .*bookings/);
  });

  it("reads past one page (more than 1,000 rows) of a table", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ id: `n${String(i).padStart(5, "0")}`, athlete_id: "c1", group_id: "g1", body: `note ${i}`, created_by: "coach", created_at: "2026-01-01" }));
    const files = await run({ ...base(), athlete_notes: many });
    expect(files.get("coach_notes.csv")!.trim().split("\r\n")).toHaveLength(2501);
    expect(files.get("export-status.txt")).toContain("coach_notes.csv: 2500 rows");
  });

  it("a coach with no clients gets headers only and a complete status", async () => {
    const files = await run({ groups: [{ id: "g1", name: "Empty" }] }, { groupIds: ["g1"] });
    expect(files.get("clients.csv")).toBe("\uFEFFclient_id,name,email,group,group_kind,joined,has_signed_in\r\n");
    expect(files.get("export-status.txt")).toMatch(/^COMPLETE/);
  });
});
