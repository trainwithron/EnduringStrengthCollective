// What is live and what is waiting: one read-only question to the database, one short report.
//
//   node scripts/state-report.mjs            ask the live database (needs SUPABASE_ACCESS_TOKEN, see below) and print the report
//   node scripts/state-report.mjs --all      also list the pastes that are already applied
//   node scripts/state-report.mjs --sql      print the one query instead (paste it into the Supabase SQL editor, then use --from)
//   node scripts/state-report.mjs --from rows.json   make the report from the query's result saved as JSON ([{"step":"159","idx":0,"applied":false}, ...])
//
// It asks "is this change already in the database?" for every check of every paste step, using the same "... is not already applied" checks the paste files use for themselves, and groups the answer by
// the bundle you actually paste. The query is assembled and checked by scripts/state-report-lib.mjs (a single select made only of catalog questions and a short list of read-only functions) and is sent to
// Supabase's READ-ONLY query endpoint, which runs it as a database role that cannot write, so it changes nothing. To use the live mode, create a personal access token in the Supabase dashboard (Account,
// Access Tokens) and put it in your environment or in .env.local as SUPABASE_ACCESS_TOKEN; the project is taken from NEXT_PUBLIC_SUPABASE_URL. The script refuses to use a token that is stored in a file
// git tracks (it would be shared with the code), and it only reads .env.local if git ignores that file. Without a token it writes the query to supabase/apply/state-report.sql (git ignores it) instead.
// The step list comes from supabase/apply/state-probes.json, written by scripts/build-paste-files.mjs.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildStateSql, formatReport, summarize } from "./state-report-lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const root = new URL("..", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(`supabase/apply/${p}`, root), "utf8"));
const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
const probes = read("state-probes.json");
const bundles = read("bundles.json");

// A value from the environment, or from .env.local only when git ignores that file and does not track it.
function envValue(name) {
  if (process.env[name]) return process.env[name];
  const file = new URL(".env.local", root);
  if (!existsSync(file)) return null;
  if (git("ls-files", "--error-unmatch", ".env.local").status === 0) throw new Error(".env.local is tracked by git, so it is not read. Remove it from git first (git rm --cached .env.local).");
  if (git("check-ignore", "-q", ".env.local").status !== 0) throw new Error(".env.local is not ignored by git, so it is not read. Add it to .gitignore first.");
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : null;
}

// Refuses to go on if the token text appears in any file git tracks.
function refuseIfTokenIsTracked(token) {
  // an empty pattern would match every line of every file, so a blank token is refused before git is asked
  if (!token || !token.trim()) throw new Error("SUPABASE_ACCESS_TOKEN is empty, so it is not used.");
  // the token goes in on standard input, never on the command line where other programs could see it
  const found = spawnSync("git", ["grep", "-F", "-q", "-f", "-"], { cwd: root, input: token, encoding: "utf8" });
  // git grep answers 0 = found, 1 = not found; anything else (an error, or git missing) means it could not be checked, so it refuses rather than guess
  if (found.status !== 0 && found.status !== 1) throw new Error("Could not check whether the access token is stored in a tracked file, so it is not used.");
  if (found.status === 0) throw new Error("The access token appears in a file that git tracks. Remove it from that file (and rotate it in the Supabase dashboard) before using it here.");
}

const sql = buildStateSql(probes);

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
    const out = new URL("supabase/apply/state-report.sql", root);
    writeFileSync(out, "-- Read-only: which paste checks are already true in the database. Changes nothing.\n" + sql + "\n");
    console.log("No SUPABASE_ACCESS_TOKEN set, so the database was not asked.");
    console.log("The one read-only query is saved in supabase/apply/state-report.sql: paste it into the Supabase SQL editor, export the result as JSON, then run");
    console.log("  node scripts/state-report.mjs --from <that file>");
    process.exit(0);
  }
  refuseIfTokenIsTracked(token);
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error(`The database did not answer (${res.status}). Check SUPABASE_ACCESS_TOKEN, or use --sql and paste the query into the SQL editor.`);
    process.exit(1);
  }
  rows = await res.json();
}

console.log(formatReport(summarize(rows, bundles, probes), { all: args.includes("--all") }));
