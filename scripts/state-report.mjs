// What is live and what is waiting: one read-only question to the database, one short report.
//
//   node scripts/state-report.mjs            ask the live database (needs SUPABASE_ACCESS_TOKEN, see below) and print the report
//   node scripts/state-report.mjs --all      also list the pastes that are already applied
//   node scripts/state-report.mjs --sql      print the one query instead (paste it into the Supabase SQL editor, then use --from)
//   node scripts/state-report.mjs --from rows.json   make the report from the query's result saved as JSON ([{"step":"159","applied":false}, ...])
//
// It asks "is this step's change already in the database?" for every paste step, using the same check each paste file uses for itself ("... is not already applied"), and groups the answer by the bundle you
// actually paste. It sends exactly one SELECT (the script refuses anything else), through Supabase's database query endpoint, so it changes nothing. To use the live mode, create a personal access token in the
// Supabase dashboard (Account, Access Tokens) and set SUPABASE_ACCESS_TOKEN; the project is taken from NEXT_PUBLIC_SUPABASE_URL in .env.local. Without a token it writes the query to
// supabase/apply/state-report.sql so it can be pasted into the SQL editor instead. The step list comes from supabase/apply/state-probes.json, written by scripts/build-paste-files.mjs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assertReadOnly, buildStateSql, formatReport, summarize } from "./state-report-lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const read = (p) => JSON.parse(readFileSync(new URL(`../supabase/apply/${p}`, import.meta.url), "utf8"));
const probes = read("state-probes.json");
const bundles = read("bundles.json");

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const file = new URL("../.env.local", import.meta.url);
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : null;
}

const sql = assertReadOnly(buildStateSql(probes));

if (args.includes("--sql")) {
  console.log(sql);
  process.exit(0);
}

let rows;
const from = flag("--from");
if (from) {
  rows = JSON.parse(readFileSync(from, "utf8"));
} else {
  const token = envValue("SUPABASE_ACCESS_TOKEN");
  const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
  const ref = url ? new URL(url).hostname.split(".")[0] : null;
  if (!token || !ref) {
    const out = new URL("../supabase/apply/state-report.sql", import.meta.url);
    writeFileSync(out, sql + "\n");
    console.log("No SUPABASE_ACCESS_TOKEN set, so the database was not asked.");
    console.log("The one read-only query is saved in supabase/apply/state-report.sql: paste it into the Supabase SQL editor, export the result as JSON, then run");
    console.log("  node scripts/state-report.mjs --from <that file>");
    process.exit(0);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error(`The database did not answer (${res.status}). Check SUPABASE_ACCESS_TOKEN.`);
    process.exit(1);
  }
  rows = await res.json();
}

console.log(formatReport(summarize(rows, bundles, probes), { all: args.includes("--all") }));
