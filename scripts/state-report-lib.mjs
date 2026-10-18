// The pure parts of scripts/state-report.mjs: from the paste steps (supabase/apply/state-probes.json) and the bundles (supabase/apply/bundles.json), build ONE read-only query that says,
// for every step, whether its change is already in the database, and turn the answer into a short report grouped by the bundle Ron actually pastes.
// Nothing here talks to the database or changes anything.

// Every step's first check is "this is not already applied"; applied = the opposite. A step with no such check is reported as unknown, never guessed.
export function buildStateSql(probes) {
  const rows = probes
    .filter((p) => p.notApplied)
    .map((p) => `    (${sqlText(p.n)}, coalesce(not (${p.notApplied}), false))`);
  if (rows.length === 0) throw new Error("no probes to run");
  return ["-- Read-only: which paste steps are already in the database. Changes nothing.", "select v.step, v.applied from (", "  values", rows.join(",\n"), ") as v(step, applied)", "order by v.step::int;"].join("\n");
}

const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;

// A guard against ever running anything but a plain read: one statement, a select, none of the words that change data or structure.
export function assertReadOnly(sql) {
  // string literals are blanked first, so a word inside quotes (for example the privilege name in a has_function_privilege check) is not mistaken for a statement
  const body = sql.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''").trim();
  const statements = body.split(";").map((s) => s.trim()).filter(Boolean);
  if (statements.length !== 1) throw new Error("the state report must be exactly one statement");
  if (!/^select\b/i.test(statements[0])) throw new Error("the state report must be a select");
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|vacuum|lock|set|reset|begin|commit)\b/i.test(statements[0])) throw new Error("the state report must not contain a statement that changes anything");
  return sql;
}

// rows: [{ step, applied }]; bundles: from bundles.json; probes: from state-probes.json. Returns the report as data.
export function summarize(rows, bundles, probes) {
  const applied = new Map(rows.map((r) => [String(r.step), r.applied === true || r.applied === "true" || r.applied === "t"]));
  const known = new Set(probes.filter((p) => p.notApplied).map((p) => p.n));
  const titleOf = new Map(probes.map((p) => [p.n, p.title]));
  const out = bundles.map((b) => {
    const states = b.steps.map((n) => (!known.has(n) || !applied.has(n) ? "unknown" : applied.get(n) ? "applied" : "waiting"));
    const status = states.every((s) => s === "applied") ? "applied" : states.every((s) => s === "waiting") ? "waiting" : states.includes("unknown") ? "unknown" : "partly";
    return { id: b.id, name: b.name, file: b.file, steps: b.steps, status, waitingSteps: b.steps.filter((n, i) => states[i] !== "applied"), titles: b.steps.map((n) => titleOf.get(n) ?? "") };
  });
  const bundled = new Set(bundles.flatMap((b) => b.steps));
  const loose = probes.filter((p) => p.notApplied && !bundled.has(p.n) && applied.get(p.n) === false).map((p) => ({ step: p.n, title: p.title }));
  return { bundles: out, loose };
}

const short = (name) => name.replace(/\s*\(.*$/s, "").trim();

export function formatReport(summary, { all = false } = {}) {
  const lines = [];
  const waiting = summary.bundles.filter((b) => b.status === "waiting" || b.status === "partly");
  const unknown = summary.bundles.filter((b) => b.status === "unknown");
  const done = summary.bundles.filter((b) => b.status === "applied");
  lines.push(`WAITING FOR A PASTE (${waiting.length})`);
  if (waiting.length === 0) lines.push("  nothing: every paste is applied");
  for (const b of waiting) lines.push(`  ${b.status === "partly" ? "PARTLY APPLIED" : "waiting"}  ${short(b.name)}  [steps ${b.waitingSteps.join(", ")}]  file: supabase/apply/${b.file}`);
  if (unknown.length > 0) {
    lines.push("", `NO CHECK AVAILABLE: ${unknown.length} bundle${unknown.length === 1 ? "" : "s"} (older pastes written before the checks existed; --all lists them)`);
    if (all) for (const b of unknown) lines.push(`  ${short(b.name)}  [steps ${b.steps.join(", ")}]`);
  }
  if (summary.loose.length > 0) {
    lines.push("", `STEPS NOT IN ANY BUNDLE AND NOT APPLIED (${summary.loose.length}; apply the single step file)`);
    for (const s of summary.loose) lines.push(`  step ${s.step}: ${s.title}`);
  }
  lines.push("", `ALREADY APPLIED: ${done.length} bundle${done.length === 1 ? "" : "s"}`);
  lines.push("", "Each answer comes from that paste's own \"is not already applied\" check. A step that a later step replaced can show as waiting here (its check looks for the old shape); docs/NEEDS_RON.md has the real order.");
  if (all) for (const b of done) lines.push(`  applied  ${short(b.name)}  [steps ${b.steps.join(", ")}]`);
  return lines.join("\n");
}
