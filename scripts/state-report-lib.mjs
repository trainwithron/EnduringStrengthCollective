// The pure parts of scripts/state-report.mjs: from the paste steps (supabase/apply/state-probes.json) and the bundles (supabase/apply/bundles.json), build ONE read-only query that says,
// for every check of every step, whether its change is already in the database, and turn the answer into a short report grouped by the bundle Ron actually pastes.
// Nothing here talks to the database or changes anything.
//
// How it is kept safe, in layers (none of them is a string filter on arbitrary SQL):
//   1. Every probe is checked to be a plain catalog question: no statement separator, no comments, no dollar quotes, no INTO, and no function call outside a short list of read-only ones.
//   2. The query is assembled by this file from fixed text around those probes, and checked again as a whole.
//   3. The command sends it to Supabase's READ-ONLY query endpoint (it runs as a database role that cannot write), so even a mistake in 1 and 2 could not change anything.

// Read-only functions the probes may call, and the SQL words that may sit directly before a parenthesis.
const ALLOWED_CALLS = new Set(["any", "chr", "coalesce", "count", "exists", "has_function_privilege", "md5", "pg_get_constraintdef", "pg_get_functiondef", "position", "replace", "to_regclass", "to_regprocedure", "v"]);
const WORDS_BEFORE_PAREN = new Set(["and", "or", "not", "in", "all", "values", "select", "from", "where", "on", "join", "then", "else", "when", "as", "by", "limit", "case", "like", "is", "null", "true", "false", "left", "right", "inner", "cross", "lateral", "using"]);

const blankLiterals = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");

// Throws unless the text is a single plain read made only of allowed pieces. Used on each probe and on the finished query.
export function assertPlainRead(sql, what = "the query") {
  if (/--|\/\*|\*\/|\$/.test(sql)) throw new Error(`${what} must not contain comments or dollar quotes`);
  const bare = blankLiterals(sql);
  const body = bare.trim().replace(/;$/, "");
  if (body.includes(";")) throw new Error(`${what} must be a single statement`);
  if (/\binto\b/i.test(bare)) throw new Error(`${what} must not use INTO`);
  if (/\bfor\s+(update|share|no\s+key|key\s+share)\b/i.test(bare)) throw new Error(`${what} must not lock rows`);
  for (const m of bare.matchAll(/([a-zA-Z_][a-zA-Z0-9_.]*)\s*\(/g)) {
    const name = m[1].toLowerCase();
    if (!ALLOWED_CALLS.has(name) && !WORDS_BEFORE_PAREN.has(name)) throw new Error(`${what} calls ${name}(), which is not on the list of read-only functions`);
  }
  return sql;
}

// Throws unless the whole query is a single select built from allowed pieces.
export function assertReadOnly(sql) {
  assertPlainRead(sql, "the state report");
  if (!/^\s*select\b/i.test(sql)) throw new Error("the state report must be a select");
  return sql;
}

const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;

// One row per check: (step, which check, applied?). A check says "this change is NOT in yet" when true, so applied = not (check). A check that cannot be decided (null) stays null: unknown, never "waiting".
export function buildStateSql(probes) {
  const rows = [];
  for (const p of probes) {
    (p.notApplied ?? []).forEach((expr, i) => {
      assertPlainRead(expr, `the check ${i + 1} of step ${p.n}`);
      rows.push(`    (${sqlText(p.n)}, ${i}, (select not e.b from (select (${expr}) as b) e))`);
    });
  }
  if (rows.length === 0) throw new Error("no probes to run");
  return assertReadOnly(["select v.step, v.idx, v.applied from (", "  values", rows.join(",\n"), ") as v(step, idx, applied)", "order by v.step::int, v.idx;"].join("\n"));
}

const isTrue = (v) => v === true || v === "true" || v === "t";

// rows: [{ step, idx?, applied }] (applied may be null = unknown). Returns the status of each step, then of each bundle.
export function summarize(rows, bundles, probes) {
  const expected = new Map(probes.filter((p) => (p.notApplied ?? []).length > 0).map((p) => [p.n, p.notApplied.length]));
  const answers = new Map();
  for (const r of rows) {
    const list = answers.get(String(r.step)) ?? [];
    list.push(r.applied === null || r.applied === undefined ? null : isTrue(r.applied));
    answers.set(String(r.step), list);
  }
  const stepStatus = (n) => {
    const want = expected.get(n);
    const got = answers.get(n);
    if (!want || !got || got.length < want || got.includes(null)) return "unknown";
    const yes = got.filter(Boolean).length;
    return yes === got.length ? "applied" : yes === 0 ? "waiting" : "partly";
  };
  const titleOf = new Map(probes.map((p) => [p.n, p.title]));
  const out = bundles.map((b) => {
    const states = b.steps.map(stepStatus);
    const known = states.filter((s) => s !== "unknown");
    // Anything known to be waiting keeps the bundle on the waiting list, whatever else could not be checked; a bundle is "applied" only when every step was checked and is in.
    const status =
      known.length === 0
        ? "unknown"
        : known.some((s) => s === "waiting" || s === "partly")
          ? known.every((s) => s === "waiting") && known.length === states.length ? "waiting" : "partly"
          : states.includes("unknown") ? "unknown" : "applied";
    return {
      id: b.id,
      name: b.name,
      file: b.file,
      steps: b.steps,
      status,
      waitingSteps: b.steps.filter((n, i) => states[i] === "waiting" || states[i] === "partly"),
      uncheckedSteps: b.steps.filter((n, i) => states[i] === "unknown"),
      titles: b.steps.map((n) => titleOf.get(n) ?? ""),
    };
  });
  const bundled = new Set(bundles.flatMap((b) => b.steps));
  const loose = probes.filter((p) => !bundled.has(p.n) && (stepStatus(p.n) === "waiting" || stepStatus(p.n) === "partly")).map((p) => ({ step: p.n, title: p.title, status: stepStatus(p.n) }));
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
  for (const b of waiting) {
    lines.push(`  ${b.status === "partly" ? "PARTLY APPLIED" : "waiting"}  ${short(b.name)}  [steps ${b.waitingSteps.join(", ")}]  file: supabase/apply/${b.file}`);
    if (b.uncheckedSteps.length > 0) lines.push(`      not checked (no check available): steps ${b.uncheckedSteps.join(", ")}`);
  }
  if (unknown.length > 0) {
    lines.push("", `NO ANSWER: ${unknown.length} bundle${unknown.length === 1 ? "" : "s"} (older pastes without a check, or a check the database could not decide; --all lists them)`);
    if (all) for (const b of unknown) lines.push(`  ${short(b.name)}  [steps ${b.steps.join(", ")}]`);
  }
  if (summary.loose.length > 0) {
    lines.push("", `STEPS NOT IN ANY BUNDLE AND NOT FULLY APPLIED (${summary.loose.length}; apply the single step file)`);
    for (const s of summary.loose) lines.push(`  step ${s.step}${s.status === "partly" ? " (partly applied)" : ""}: ${s.title}`);
  }
  lines.push("", `ALREADY APPLIED: ${done.length} bundle${done.length === 1 ? "" : "s"}`);
  if (all) for (const b of done) lines.push(`  applied  ${short(b.name)}  [steps ${b.steps.join(", ")}]`);
  lines.push("", "Each answer comes from that paste's own \"is not already applied\" checks; a step is applied only when every one of its checks says so. A step that a later step replaced can show as waiting here (its check looks for the old shape); docs/NEEDS_RON.md has the real order.");
  return lines.join("\n");
}
