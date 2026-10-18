// The team sheet's reads name columns (SHEET_READS in lib/team-sheet/load-sheet.ts, CONTEXT_READS in lib/team-sheet/review.ts, SAVED_UPLOAD_COLUMNS in lib/team-sheet/reads.ts). A column that does not exist makes the whole
// read fail in production, and a test with a made-up database cannot see that, so every name is checked here against the real table definitions of the migration chain.
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// "a, b, rel ( c, d )" -> { own: [a, b], rel: { rel: [c, d] } } (one level of embedding is all these reads use)
function parseSelect(text) {
  const own = [];
  const rel = {};
  let depth = 0;
  let cur = "";
  const parts = [];
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const m = /^\s*([a-z_]+)\s*\(([^)]*)\)\s*$/.exec(p);
    if (m) rel[m[1]] = m[2].split(",").map((s) => s.trim()).filter(Boolean);
    else if (p.trim()) own.push(p.trim());
  }
  return { own, rel };
}

// { key: "select text" } entries of an exported object
function parseBlock(src, start) {
  const from = src.indexOf(start);
  const block = src.slice(from, src.indexOf("} as const;", from));
  return Object.fromEntries(Array.from(block.matchAll(/^\s+([a-z]+): "([^"]+)",?$/gm)).map((m) => [m[1], m[2]]));
}

export default {
  name: "Team sheet reads name real columns",
  migrations: [],
  phases: {
    async "0419"({ db, h }) {
      const sheet = parseBlock(read("lib/team-sheet/load-sheet.ts"), "export const SHEET_READS = {");
      const context = parseBlock(read("lib/team-sheet/review.ts"), "export const CONTEXT_READS = {");
      const saved = /SAVED_UPLOAD_COLUMNS = "([^"]+)"/.exec(read("lib/team-sheet/reads.ts"))?.[1];
      h.check("every read was found in the source", Object.keys(sheet).sort().join(",") === "exercises,groups,programs,roster,workouts" && Object.keys(context).sort().join(",") === "exercises,roster,sessions,workouts" && !!saved, JSON.stringify([Object.keys(sheet), Object.keys(context), !!saved]));
      const reads = [
        ...Object.entries(sheet).map(([k, v]) => [`load ${k}`, { groups: "groups", programs: "programs", workouts: "workouts", exercises: "group_workout_exercises", roster: "group_memberships" }[k], v]),
        ...Object.entries(context).map(([k, v]) => [`review ${k}`, { exercises: "group_workout_exercises", workouts: "workouts", roster: "group_memberships", sessions: "athlete_sessions" }[k], v]),
        ["saved uploads", "team_sheet_batches", saved ?? ""],
      ];
      await h.asSuper();
      const columns = async (table) => new Set((await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows.map((r) => r.column_name));
      for (const [name, table, text] of reads) {
        const { own, rel } = parseSelect(text);
        const have = await columns(table);
        const missing = own.filter((c) => !have.has(c));
        h.check(`${name}: every column of ${table} it reads exists` + (missing.length ? " (missing: " + missing.join(", ") + ")" : ""), have.size > 0 && missing.length === 0);
        for (const [relTable, cols] of Object.entries(rel)) {
          const relHave = await columns(relTable);
          const relMissing = cols.filter((c) => !relHave.has(c));
          h.check(`${name}: every column of ${relTable} it embeds exists` + (relMissing.length ? " (missing: " + relMissing.join(", ") + ")" : ""), relHave.size > 0 && relMissing.length === 0);
        }
      }
      // the filters and orderings the reads and routes apply
      const need = {
        group_workout_exercises: ["athlete_id", "exercise_order", "group_id", "id", "workout_id"],
        programs: ["group_id", "is_active", "athlete_id", "created_at"],
        workouts: ["program_id", "week_number", "day_index", "id", "group_id"],
        group_memberships: ["group_id", "role", "profile_id"],
        athlete_sessions: ["group_id", "workout_id", "id"],
        team_sheet_batches: ["group_id", "created_at", "id"],
      };
      for (const [table, cols] of Object.entries(need)) {
        const have = await columns(table);
        h.check(`${table}: the columns the reads filter and order on exist`, cols.every((c) => have.has(c)), cols.filter((c) => !have.has(c)).join(", "));
      }
    },
  },
};
