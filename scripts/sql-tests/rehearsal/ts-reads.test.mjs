// The team sheet's reads (lib/team-sheet/load-sheet.ts SHEET_READS) name columns. A column that does not exist makes the whole read fail in production, and a test with a made-up database cannot see that, so every
// name is checked here against the real table definitions of the migration chain.
import { readFileSync } from "node:fs";

const TABLES = { groups: "groups", workouts: "workouts", exercises: "group_workout_exercises", roster: "group_memberships" };

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

export default {
  name: "Team sheet reads name real columns",
  migrations: [],
  phases: {
    async "0418"({ db, h }) {
      const src = readFileSync(new URL("../../../lib/team-sheet/load-sheet.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
      const block = src.slice(src.indexOf("export const SHEET_READS = {"), src.indexOf("} as const;"));
      const reads = Object.fromEntries(Array.from(block.matchAll(/^\s+([a-z]+): "([^"]+)",?$/gm)).map((m) => [m[1], m[2]]));
      h.check("the four reads were found in the source", Object.keys(reads).sort().join(",") === "exercises,groups,roster,workouts", JSON.stringify(Object.keys(reads)));
      await h.asSuper();
      const columns = async (table) => new Set((await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows.map((r) => r.column_name));
      for (const [name, text] of Object.entries(reads)) {
        const table = TABLES[name];
        const { own, rel } = parseSelect(text);
        const have = await columns(table);
        const missing = own.filter((c) => !have.has(c));
        h.check(`${name}: every column of ${table} it reads exists` + (missing.length ? " (missing: " + missing.join(", ") + ")" : ""), missing.length === 0);
        for (const [relTable, cols] of Object.entries(rel)) {
          const relHave = await columns(relTable);
          const relMissing = cols.filter((c) => !relHave.has(c));
          h.check(`${name}: every column of ${relTable} it embeds exists` + (relMissing.length ? " (missing: " + relMissing.join(", ") + ")" : ""), relHave.size > 0 && relMissing.length === 0);
        }
      }
      // the filters the loader applies
      const gwe = await columns("group_workout_exercises");
      h.check("the exercises read filters on athlete_id and orders by exercise_order, which exist", gwe.has("athlete_id") && gwe.has("exercise_order"));
    },
  },
};
