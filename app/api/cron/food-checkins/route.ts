import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { withCronRun } from "@/lib/cron-monitor";
import { pageAll } from "@/lib/page-all";
import { runPool } from "@/lib/run-pool";
import { addDaysToKey, dateKeyInZone, DEFAULT_COACH_TIMEZONE, getGroupCoachTimezone, nowInZone } from "@/lib/timezone";
import { fetchStandingHistory } from "@/lib/standing-macros";
import { standingForDate } from "@/lib/macro-resolution";
import { checkinCoach } from "@/lib/weekly-checkin-server";
import { loadPausedKeys } from "@/lib/nutrition-pause";
import { NOT_IMPORTED } from "@/lib/imported-food";
import { CHECKIN_GAP_DAYS, CHECKIN_LOCAL_HOUR, OFF_WINDOW_DAYS, checkinAllowed, checkinTrigger, clientCheckinPath, clientNotice, coachCheckinPath, sentNotice } from "@/lib/food-checkin";

// Every hour (vercel.json), the food check-in (Ron, Nov 24: "build it"; lib/food-checkin.ts has the rules and the words). A client whose own clock says 10 in the morning is looked
// at once that day: nothing logged for 3 days, or logged calories averaging more than 15% off target over the last 7 days with at least 4 logged, gets a short check-in from
// their coach (a bell and a push, in the coach's name), and the coach gets one bell that it was sent. Never more than one in 7 days per client, across all their groups.
// Nobody is checked whose food tracking is off, who has no calorie target (or whose coach set "No macros"), whose group is in youth mode, or whose coach turned "Food check-ins"
// off for them; nor anyone with "No automatic nutrition suggestions" (a safety switch: their food is only ever raised by the coach, in person).
export const maxDuration = 300;
const AT_ONCE = 8;
const TIME_BUDGET_MS = 270_000;

interface Seat {
  profile_id: string;
  group_id: string;
  client_tier: string | null;
  coach_sets_macros: boolean | null;
  food_tracking_enabled: boolean | null;
}

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const db = createServiceRoleClient();
  const now = new Date();

  // A check-in still unanswered after 7 days has expired (the next one may follow).
  const { error: expireError } = await db.from("client_food_checkins").update({ status: "expired" }).eq("status", "sent").lt("sent_at", new Date(now.getTime() - CHECKIN_GAP_DAYS * 86400000).toISOString());
  if (expireError) console.error("food-checkins: could not close old check-ins:", expireError.message);

  // Every client seat with food tracking on and targets the coach sets (a group client has no targets of their own).
  const seats = await pageAll((from, to) =>
    db.from("group_memberships").select("profile_id, group_id, client_tier, coach_sets_macros, food_tracking_enabled").eq("role", "athlete").order("profile_id").order("group_id").range(from, to)
  , { maxPages: 100 });
  if (seats.failed || seats.truncated) return NextResponse.json({ error: "Could not read the clients." }, { status: 500 });
  // Without the switches, nobody is checked (never a check-in to someone the coach switched off).
  const paused = await loadPausedKeys(db);
  if (paused.failed) return NextResponse.json({ error: "Could not read the nutrition switches." }, { status: 500 });
  const off = await pageAll((from, to) => db.from("client_nutrition_flags").select("profile_id, group_id").eq("checkins_off", true).order("profile_id").order("group_id").range(from, to), { maxPages: 100 });
  if (off.failed || off.truncated) return NextResponse.json({ error: "Could not read the check-in switches." }, { status: 500 });
  const switchedOff = new Set((off.rows as { profile_id: string; group_id: string }[]).map((r) => `${r.profile_id}|${r.group_id}`));

  const eligible = (seats.rows as Seat[]).filter(
    (s) =>
      s.food_tracking_enabled !== false &&
      s.client_tier !== "group" &&
      s.coach_sets_macros !== false &&
      !paused.keys.has(`${s.profile_id}|${s.group_id}`) &&
      !paused.profiles.has(s.profile_id) &&
      !switchedOff.has(`${s.profile_id}|${s.group_id}`)
  );
  if (eligible.length === 0) return NextResponse.json({ clients: 0, sent: 0 });

  // Youth mode is the group's (no calorie numbers for its clients): none of them are checked.
  const groupIds = [...new Set(eligible.map((s) => s.group_id))];
  const youth = new Set<string>();
  for (let i = 0; i < groupIds.length; i += 200) {
    const { data, error } = await db.from("groups").select("id, nutrition_youth_mode").in("id", groupIds.slice(i, i + 200));
    if (error) return NextResponse.json({ error: "Could not read the groups." }, { status: 500 });
    for (const g of (data ?? []) as { id: string; nutrition_youth_mode: boolean | null }[]) if (g.nutrition_youth_mode) youth.add(g.id);
  }

  // Each client's own clock (their profile's time zone, else their group's): only those for whom it is 10 in the morning now.
  const people = [...new Set(eligible.map((s) => s.profile_id))];
  const profileOf = new Map<string, { name: string; zone: string | null }>();
  for (let i = 0; i < people.length; i += 200) {
    const { data, error } = await db.from("profiles").select("id, full_name, timezone").in("id", people.slice(i, i + 200));
    if (error) return NextResponse.json({ error: "Could not read the clients' profiles." }, { status: 500 });
    for (const p of (data ?? []) as { id: string; full_name: string | null; timezone: string | null }[]) profileOf.set(p.id, { name: (p.full_name ?? "").trim(), zone: (p.timezone ?? "").trim() || null });
  }
  const seatsByPerson = new Map<string, string[]>();
  for (const s of eligible) if (!youth.has(s.group_id)) seatsByPerson.set(s.profile_id, [...(seatsByPerson.get(s.profile_id) ?? []), s.group_id]);

  // The check-ins of the last 7 days: anyone who had one is not sent another (answered or not).
  const recent = new Set<string>();
  const ids = [...seatsByPerson.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("client_food_checkins").select("athlete_id, sent_at").in("athlete_id", ids.slice(i, i + 200)).gte("sent_at", new Date(now.getTime() - CHECKIN_GAP_DAYS * 86400000).toISOString());
    // Without the record of who was asked, nobody is asked rather than someone twice.
    if (error) return NextResponse.json({ error: "Could not read the check-ins already sent." }, { status: 500 });
    for (const r of (data ?? []) as { athlete_id: string; sent_at: string }[]) if (!checkinAllowed([r.sent_at], now)) recent.add(r.athlete_id);
  }

  let sent = 0;
  let notMorning = 0;
  let recordFailures = 0;
  const processPerson = async ([athleteId, groups]: [string, string[]]): Promise<void> => {
    if (recent.has(athleteId)) return;
    const person = profileOf.get(athleteId);
    for (const groupId of groups) {
      const zone = person?.zone ?? (await getGroupCoachTimezone(db, groupId)) ?? DEFAULT_COACH_TIMEZONE;
      let hour: number;
      let todayKey: string;
      try {
        hour = nowInZone(zone, now).getUTCHours();
        todayKey = dateKeyInZone(zone, now);
      } catch {
        continue;
      }
      if (hour !== CHECKIN_LOCAL_HOUR) {
        notMorning += 1;
        return;
      }

      const standing = standingForDate(await fetchStandingHistory(db, athleteId, groupId), todayKey);
      if (!standing?.calories) continue;
      const [{ data: rows, error: rowsError }, { data: earlier }] = await Promise.all([
        db.from("food_log_entries").select("log_date, status, food_source, calories").eq("athlete_id", athleteId).eq("group_id", groupId).gte("log_date", addDaysToKey(todayKey, -(OFF_WINDOW_DAYS + 1))).limit(2000),
        db.from("food_log_entries").select("log_date").eq("athlete_id", athleteId).eq("group_id", groupId).lt("log_date", addDaysToKey(todayKey, -(OFF_WINDOW_DAYS + 1))).neq("status", "skipped").or(NOT_IMPORTED).limit(1),
      ]);
      if (rowsError) continue;
      const trigger = checkinTrigger({
        entries: rows ?? [],
        todayKey,
        targetKcal: Number(standing.calories),
        targetSinceKey: standing.effective_from ?? null,
        everLoggedBefore: (earlier ?? []).length > 0,
      });
      if (!trigger) continue;
      const coach = await checkinCoach(db, groupId, athleteId);
      if (!coach) continue;

      // The record first: the 7-day limit must see it even if a notice then fails.
      const record = {
        athlete_id: athleteId,
        group_id: groupId,
        coach_id: coach.id,
        trigger: trigger.kind,
        avg_diff_kcal: trigger.kind === "off" ? trigger.avgDiffKcal : null,
        days_logged: trigger.kind === "off" ? trigger.daysLogged : null,
        target_kcal: Math.round(Number(standing.calories)),
      };
      const { error: recordError } = await db.from("client_food_checkins").insert(record);
      if (recordError) {
        console.error("food-checkins: could not record a check-in:", recordError.message);
        recordFailures += 1;
        return;
      }
      const notice = clientNotice(trigger, coach.name);
      await db.from("notifications").insert({ profile_id: athleteId, group_id: groupId, type: "food_checkin", body: notice.line, link_path: clientCheckinPath(groupId) });
      await sendPushToProfile(db, athleteId, notice.title, notice.body, clientCheckinPath(groupId)).catch(() => 0);
      // The coach's own bell (their "Client activity" switch applies in the database); no push, it is only for the record.
      await db.from("notifications").insert({ profile_id: coach.id, group_id: groupId, type: "food_checkin_sent", body: sentNotice(record, person?.name ?? null), link_path: coachCheckinPath(groupId, athleteId) });
      sent += 1;
      return; // one per client, even if several groups qualify
    }
  };
  const run = await runPool([...seatsByPerson.entries()], AT_ONCE, processPerson, { deadlineMs: TIME_BUDGET_MS });
  if (run.notStarted.length > 0) console.error(`food-checkins: out of time, ${run.notStarted.length} clients were not looked at`);
  if (run.failed.length > 0) console.error(`food-checkins: ${run.failed.length} clients failed`);
  return NextResponse.json({ clients: seatsByPerson.size, sent, notMorning, recordFailures });
}

export const GET = withCronRun("food-checkins", handler);
