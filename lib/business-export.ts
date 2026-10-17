import { chunk } from "@/lib/chunk";
import { csvLine, utf8, type ZipEntry } from "@/lib/zip-store";

// "Export my business": a coach takes their records with them. One ZIP of plain CSV files that open in any spreadsheet, made as it is sent. It is read as the signed-in coach, so it holds exactly what row security
// lets that coach see in those groups (never another trainer's private clients). Every read is in pages and every group goes in chunks of ids, so a coach with 1,500 clients is exported the same way as one with 15.
// A read that fails is named in export-status.txt at the end of the archive; a missing file is never read as "nothing there".

export interface ExportDeps {
  // A query for one chunk of ids and one page of rows; the query must be ordered by something unique.
  groupIds: string[];
  supabase: any;
  orgName: string;
  // The sign-in email of each client id (not placeholders), looked up by the caller with the server key; may be empty.
  emailsFor: (profileIds: string[]) => Promise<Map<string, string>>;
  now?: Date;
  // Filled in as the export finishes: the parts that could not be read completely (the same list export-status.txt names). A caller that must not keep an incomplete export reads it.
  report?: { failed: string[] };
}

const PAGE = 1000;
const CHUNK = 100;

type Rows = Record<string, any>[];
type Make = (ids: string[], from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>;

export interface ExportFileInfo {
  file: string;
  description: string;
}

export const EXPORT_FILES: ExportFileInfo[] = [
  { file: "clients.csv", description: "Every client: name, email (when they have one), group, when they joined, and whether they have signed in yet." },
  { file: "groups.csv", description: "Your groups and one-on-one spaces." },
  { file: "programs.csv", description: "Your programs." },
  { file: "workouts.csv", description: "The workouts in your programs: program, week, day, date and notes." },
  { file: "planned_exercises.csv", description: "The exercises planned in each workout." },
  { file: "planned_sets.csv", description: "The planned sets of each exercise: target reps, weight, RPE, rest and so on." },
  { file: "workouts_done.csv", description: "Every workout a client started or finished: who, when, how long, how hard (session RPE)." },
  { file: "sets_logged.csv", description: "Every set a client logged: who, when, exercise, weight, reps, RPE, and whether it is marked unclear." },
  { file: "bookings.csv", description: "Bookings: who, when, status, no-shows and late cancels." },
  { file: "session_credits.csv", description: "Each client's current session credit balance." },
  { file: "payments_credits.csv", description: "Credit purchases: when, how many, the amount in cents." },
  { file: "packages.csv", description: "Your packages (name, price in cents, sessions granted) and who has each (package_assignments.csv)." },
  { file: "package_assignments.csv", description: "Which client has which package." },
  { file: "body_weight.csv", description: "Body weight logs." },
  { file: "nutrition_daily.csv", description: "Daily calories and macros logged." },
  { file: "coach_notes.csv", description: "Your notes about clients." },
];

export const EXPORT_NOT_INCLUDED = [
  "Photos, videos, scans and uploaded files (they are not part of this file; ask us if you need them).",
  "Messages and the feed.",
  "Health forms and signed waivers (keep these through the form's own page).",
  "Anything another coach keeps private from the organization.",
];

export function readmeText(orgName: string, now: Date): string {
  return [
    `Your data from ${orgName}`,
    `Exported ${now.toISOString()}`,
    "",
    "Each .csv file opens in Excel, Google Sheets or Numbers. Dates are in UTC unless a column says otherwise. Money is in cents.",
    "",
    "What is in this export:",
    ...EXPORT_FILES.map((f) => `- ${f.file}: ${f.description}`),
    "",
    "What is not in this export:",
    ...EXPORT_NOT_INCLUDED.map((l) => `- ${l}`),
    "",
    "export-status.txt (the last file) says whether every part was read. If a part could not be read it is named there; run the export again.",
    "",
  ].join("\r\n");
}

async function* pagedByIds(ids: string[], make: Make, failures: string[], label: string): AsyncGenerator<Rows> {
  for (const idChunk of chunk([...new Set(ids)], CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await make(idChunk, from, from + PAGE - 1);
      if (error) {
        failures.push(label);
        break;
      }
      const rows = (data ?? []) as Rows;
      if (rows.length > 0) yield rows;
      if (rows.length < PAGE) break;
    }
  }
}

async function* csvOf(columns: string[], pages: AsyncIterable<Rows>, counter: { n: number }): AsyncGenerator<Uint8Array> {
  // A byte-order mark first, so Excel opens the file as UTF-8 (without it, names like José show as garbage).
  yield utf8("\uFEFF" + csvLine(columns));
  for await (const rows of pages) {
    counter.n += rows.length;
    yield utf8(rows.map((r) => csvLine(columns.map((c) => r[c]))).join(""));
  }
}

async function* once(rows: Rows): AsyncGenerator<Rows> {
  if (rows.length > 0) yield rows;
}

export async function* exportEntries(deps: ExportDeps): AsyncGenerator<ZipEntry> {
  const { supabase, groupIds } = deps;
  const now = deps.now ?? new Date();
  const failures: string[] = [];
  const counts: { file: string; n: number }[] = [];

  const file = (name: string, columns: string[], pages: AsyncIterable<Rows>): ZipEntry => {
    const counter = { n: 0 };
    counts.push({ file: name, n: 0 });
    const idx = counts.length - 1;
    return {
      name,
      chunks: (async function* () {
        yield* csvOf(columns, pages, counter);
        counts[idx].n = counter.n;
      })(),
    };
  };

  // Reads one table by a column that is a group id (or any id the table is keyed on), a page at a time.
  const byColumn = (table: string, column: string, order: string[]): Make => (ids, from, to) => {
    let q = supabase.from(table).select("*").in(column, ids);
    for (const o of order) q = q.order(o);
    return q.range(from, to);
  };

  yield { name: "README.txt", chunks: (async function* () { yield utf8(readmeText(deps.orgName, now)); })() };

  // ---- clients
  const memberRows: Rows = [];
  for await (const page of pagedByIds(groupIds, byColumn("group_memberships", "group_id", ["id"]), failures, "clients")) memberRows.push(...page);
  const athletes = memberRows.filter((m) => m.role === "athlete");
  const athleteIds = [...new Set(athletes.map((m) => m.profile_id as string))];
  const profileById = new Map<string, any>();
  for await (const page of pagedByIds(athleteIds, (ids, from, to) => supabase.from("profiles").select("id, full_name, claimed_at, created_at").in("id", ids).order("id").range(from, to), failures, "clients (names)")) {
    for (const p of page) profileById.set(p.id, p);
  }
  let emails = new Map<string, string>();
  try {
    emails = await deps.emailsFor(athleteIds);
  } catch {
    failures.push("clients (emails)");
  }
  const groupRows: Rows = [];
  for await (const page of pagedByIds(groupIds, byColumn("groups", "id", ["id"]), failures, "groups")) groupRows.push(...page);
  const groupById = new Map(groupRows.map((g) => [g.id as string, g]));

  const clientRows = athletes
    .map((m) => {
      const p = profileById.get(m.profile_id);
      const g = groupById.get(m.group_id);
      return { client_id: m.profile_id, name: p?.full_name ?? "", email: emails.get(m.profile_id) ?? "", group: g?.name ?? "", group_kind: g?.group_kind ?? "", joined: m.joined_at ?? "", has_signed_in: p ? (p.claimed_at ? "yes" : "no") : "" };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  yield file("clients.csv", ["client_id", "name", "email", "group", "group_kind", "joined", "has_signed_in"], once(clientRows));
  yield file("groups.csv", ["id", "name", "group_kind", "description", "created_at", "organization_id"], once(groupRows.sort((a, b) => String(a.name).localeCompare(String(b.name)))));

  // ---- programs and plans
  yield file("programs.csv", ["id", "group_id", "athlete_id", "name", "description", "is_active", "start_date", "training_days", "created_at", "archived_at"], pagedByIds(groupIds, byColumn("programs", "group_id", ["id"]), failures, "programs"));
  yield file("workouts.csv", ["id", "program_id", "group_id", "athlete_id", "title", "week_number", "day_index", "scheduled_date", "notes", "created_at"], pagedByIds(groupIds, byColumn("workouts", "group_id", ["id"]), failures, "workouts"));
  yield file(
    "planned_exercises.csv",
    ["id", "workout_id", "group_id", "athlete_id", "exercise_name", "display_name", "exercise_order", "notes", "created_at"],
    pagedByIds(groupIds, byColumn("group_workout_exercises", "group_id", ["id"]), failures, "planned exercises")
  );
  yield file(
    "planned_sets.csv",
    ["id", "group_workout_exercise_id", "set_order", "target_reps", "rep_min", "rep_max", "target_weight", "target_rpe", "target_rir", "target_tempo", "target_time_seconds", "target_distance", "target_rest_seconds", "target_pace"],
    (async function* () {
      for await (const exPage of pagedByIds(groupIds, byColumn("group_workout_exercises", "group_id", ["id"]), failures, "planned sets")) {
        yield* pagedByIds(exPage.map((e) => e.id as string), byColumn("group_workout_exercise_sets", "group_workout_exercise_id", ["id"]), failures, "planned sets");
      }
    })()
  );

  // ---- what clients did
  yield file(
    "workouts_done.csv",
    ["id", "athlete_id", "group_id", "workout_id", "status", "started_at", "completed_at", "duration_seconds", "session_rpe", "is_historical", "logged_by_coach"],
    pagedByIds(groupIds, byColumn("athlete_sessions", "group_id", ["id"]), failures, "workouts done")
  );
  yield file(
    "sets_logged.csv",
    ["session_id", "athlete_id", "group_id", "session_date", "exercise_name", "set_order", "set_type", "weight", "reps", "rpe", "time_seconds", "distance", "status", "completed_at", "is_historical", "data_flag", "data_flag_reason"],
    (async function* () {
      for await (const sessions of pagedByIds(groupIds, byColumn("athlete_sessions", "group_id", ["id"]), failures, "sets logged")) {
        const sessionById = new Map(sessions.map((s) => [s.id as string, s]));
        for await (const exercises of pagedByIds(sessions.map((s) => s.id as string), byColumn("session_exercises", "session_id", ["id"]), failures, "sets logged")) {
          const exerciseById = new Map(exercises.map((e) => [e.id as string, e]));
          for await (const sets of pagedByIds(exercises.map((e) => e.id as string), byColumn("set_logs", "session_exercise_id", ["id"]), failures, "sets logged")) {
            yield sets.map((s) => {
              const ex = exerciseById.get(s.session_exercise_id);
              const se = ex ? sessionById.get(ex.session_id) : undefined;
              return { ...s, session_id: ex?.session_id ?? "", athlete_id: se?.athlete_id ?? "", group_id: se?.group_id ?? "", session_date: se?.completed_at ?? se?.started_at ?? "", exercise_name: ex?.exercise_name ?? "" };
            });
          }
        }
      }
    })()
  );

  // ---- bookings and money
  yield file("bookings.csv", ["id", "athlete_id", "coach_id", "group_id", "start_at", "end_at", "status", "session_type", "no_show", "late_cancel", "attended_at", "created_at"], pagedByIds(groupIds, byColumn("bookings", "group_id", ["id"]), failures, "bookings"));
  yield file("session_credits.csv", ["athlete_id", "group_id", "balance", "updated_at"], pagedByIds(groupIds, byColumn("session_credits", "group_id", ["group_id", "athlete_id"]), failures, "session credits"));
  yield file("payments_credits.csv", ["id", "athlete_id", "group_id", "credits_purchased", "amount_cents", "coach_package_id", "created_at"], pagedByIds(groupIds, byColumn("credit_purchases", "group_id", ["id"]), failures, "credit purchases"));
  const packageRows: Rows = [];
  for await (const page of pagedByIds(groupIds, byColumn("coach_packages", "group_id", ["id"]), failures, "packages")) packageRows.push(...page);
  yield file("packages.csv", ["id", "group_id", "name", "billing_type", "sessions_granted", "sessions_per_week", "rate_cents", "is_active", "created_at"], once(packageRows));
  yield file("package_assignments.csv", ["id", "coach_package_id", "athlete_id", "created_at"], pagedByIds(packageRows.map((p) => p.id as string), byColumn("package_assignments", "coach_package_id", ["id"]), failures, "package assignments"));

  // ---- measurements, food, notes
  yield file("body_weight.csv", ["id", "athlete_id", "group_id", "logged_date", "weight", "created_at"], pagedByIds(groupIds, byColumn("body_weight_logs", "group_id", ["id"]), failures, "body weight"));
  yield file("nutrition_daily.csv", ["athlete_id", "group_id", "log_date", "calories", "protein_g", "carbs_g", "fat_g"], pagedByIds(groupIds, byColumn("daily_macros", "group_id", ["group_id", "athlete_id", "log_date"]), failures, "nutrition"));
  yield file("coach_notes.csv", ["id", "athlete_id", "group_id", "body", "created_by", "created_at"], pagedByIds(groupIds, byColumn("athlete_notes", "group_id", ["id"]), failures, "notes"));

  yield {
    name: "export-status.txt",
    chunks: (async function* () {
      const failed = [...new Set(failures)];
      if (deps.report) deps.report.failed = failed;
      yield utf8(
        [
          failed.length === 0 ? "COMPLETE: every part was read." : `INCOMPLETE: these parts could not be read completely: ${failed.join(", ")}. Run the export again.`,
          `Groups: ${groupIds.length}`,
          ...counts.map((c) => `${c.file}: ${c.n} rows`),
          "",
        ].join("\r\n")
      );
    })(),
  };
}
