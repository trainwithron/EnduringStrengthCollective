import { pageAll } from "@/lib/page-all";
import { addDaysToKey, DEFAULT_COACH_TIMEZONE, dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";
import { readByIds } from "@/lib/read-by-ids";

// What each coach in an organization has done, for the owner or an admin: clients, sessions delivered in a period, no-shows and late cancels, clients who have gone quiet, and clients low on sessions. Read
// as the signed-in owner/admin, so row security decides what is counted (a client who keeps their records private from the organization is never in these numbers, and never named). A session counts as
// DELIVERED when it was confirmed, its time has passed, and it was not marked a no-show: bookings that were only made are not paid as if they happened. The numbers come with the list of sessions behind
// them (sessionLines) so a total can always be traced to the sessions it is made of.
export interface CoachActivityRow {
  coachId: string;
  name: string;
  role: string;
  clients: number;
  sessionsDelivered: number;
  noShows: number;
  lateCancels: number;
  quietClients: number;
  lowBalanceClients: number;
}

export interface SessionLine {
  bookingId: string;
  coachId: string;
  coachName: string;
  startAt: string;
  clientName: string;
  sessionType: string;
}

export interface CoachActivity {
  rows: CoachActivityRow[];
  sessionLines: SessionLine[];
  creditsSold: number;
  failed: boolean;
  truncated: boolean;
}

export const QUIET_DAYS = 14;
export const LOW_BALANCE_AT = 1;

// The period as two real instants, from a "YYYY-MM-DD" start and end (the end day included), cut at midnight in the viewer's time zone (a 6pm Pacific session on the last day of the month belongs to that month,
// not the next one). A bad or reversed date falls back to this month so far.
export function activityPeriod(
  from: string | undefined,
  to: string | undefined,
  timeZone: string = DEFAULT_COACH_TIMEZONE,
  now: Date = new Date()
): { fromIso: string; toIso: string; fromDay: string; toDay: string; timeZone: string } {
  const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s ? s : null);
  const today = dateKeyInZone(timeZone, now);
  const firstOfMonth = today.slice(0, 8) + "01";
  let fromDay = day(from) ?? firstOfMonth;
  let toDay = day(to) ?? today;
  if (fromDay > toDay) {
    fromDay = firstOfMonth;
    toDay = today;
  }
  return {
    fromIso: zonedTimeToUtc(fromDay, "00:00", timeZone).toISOString(),
    toIso: zonedTimeToUtc(addDaysToKey(toDay, 1), "00:00", timeZone).toISOString(),
    fromDay,
    toDay,
    timeZone,
  };
}

// A rate typed in dollars ("45" or "45.50"): whole cents, or null when it is not a plain amount. Used on screen and by the spreadsheet so they always agree.
export const MAX_RATE_CENTS = 100_000_000;
export function parseRateToCents(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(parseFloat(t) * 100);
  return cents <= MAX_RATE_CENTS ? cents : null;
}

export async function loadCoachActivity(supabase: any, args: { orgId: string; fromIso: string; toIso: string; now?: Date }): Promise<CoachActivity> {
  const now = args.now ?? new Date();
  let failed = false;
  let truncated = false;
  const mark = (r: { failed: boolean; truncated: boolean }) => {
    failed ||= r.failed;
    truncated ||= r.truncated;
  };

  const [members, groups] = await Promise.all([
    supabase.from("organization_memberships").select("profile_id, role, profiles ( full_name )").eq("organization_id", args.orgId),
    pageAll((from: number, to: number) => supabase.from("groups").select("id").eq("organization_id", args.orgId).order("id").range(from, to), { maxPages: 100 }),
  ]);
  if (members.error) failed = true;
  mark(groups);
  const groupIds = groups.rows.map((g) => g.id as string);

  const [seats, athletes, bookings, purchases, credits, lastActive] = await Promise.all([
    readByIds(groupIds, (ids) => (from, to) => supabase.from("group_memberships").select("id, group_id, profile_id").in("group_id", ids).eq("role", "coach").order("id").range(from, to), { maxPages: 100 }),
    readByIds(groupIds, (ids) => (from, to) => supabase.from("group_memberships").select("id, group_id, profile_id, profiles ( full_name )").in("group_id", ids).eq("role", "athlete").order("id").range(from, to), { maxPages: 100 }),
    readByIds(
      groupIds,
      (ids) => (from, to) =>
        supabase
          .from("bookings")
          .select("id, coach_id, athlete_id, group_id, start_at, status, no_show, late_cancel, session_type")
          .in("group_id", ids)
          .gte("start_at", args.fromIso)
          .lt("start_at", args.toIso)
          .order("id")
          .range(from, to),
      { maxPages: 100 }
    ),
    readByIds(groupIds, (ids) => (from, to) => supabase.from("credit_purchases").select("id, credits_purchased").in("group_id", ids).gte("created_at", args.fromIso).lt("created_at", args.toIso).order("id").range(from, to), { maxPages: 100 }),
    readByIds(groupIds, (ids) => (from, to) => supabase.from("session_credits").select("athlete_id, group_id, balance").in("group_id", ids).lte("balance", LOW_BALANCE_AT).order("group_id").order("athlete_id").range(from, to), { maxPages: 100 }),
    groupIds.length === 0 ? Promise.resolve({ rows: [] as any[], failed: false, truncated: false }) : pageAll((from: number, to: number) => supabase.rpc("business_last_active", { p_group_ids: groupIds }).range(from, to), { maxPages: 100 }),
  ]);
  for (const r of [seats, athletes, bookings, purchases, credits, lastActive]) mark(r);

  const nameOf = new Map<string, { name: string; role: string }>();
  for (const m of (members.data ?? []) as any[]) nameOf.set(m.profile_id, { name: m.profiles?.full_name ?? "Coach", role: m.role });

  const coachesByGroup = new Map<string, string[]>();
  for (const s of seats.rows) coachesByGroup.set(s.group_id, [...(coachesByGroup.get(s.group_id) ?? []), s.profile_id]);
  const clientName = new Map<string, string>();
  const clientsOf = new Map<string, Set<string>>();
  for (const a of athletes.rows) {
    clientName.set(a.profile_id, a.profiles?.full_name ?? "Client");
    for (const c of coachesByGroup.get(a.group_id) ?? []) {
      const set = clientsOf.get(c) ?? new Set<string>();
      set.add(a.profile_id);
      clientsOf.set(c, set);
    }
  }
  const lastAt = new Map<string, number>();
  for (const l of lastActive.rows) lastAt.set(l.athlete_id, new Date(l.last_at).getTime());
  const lowBalance = new Set<string>(credits.rows.map((c) => c.athlete_id as string));
  const quietBefore = now.getTime() - QUIET_DAYS * 86400000;

  const stats = new Map<string, CoachActivityRow>();
  const rowFor = (coachId: string) => {
    let r = stats.get(coachId);
    if (!r) {
      const info = nameOf.get(coachId);
      r = { coachId, name: info?.name ?? "Former coach", role: info?.role ?? "", clients: 0, sessionsDelivered: 0, noShows: 0, lateCancels: 0, quietClients: 0, lowBalanceClients: 0 };
      stats.set(coachId, r);
    }
    return r;
  };
  for (const coachId of nameOf.keys()) rowFor(coachId);
  for (const [coachId, set] of clientsOf) {
    const r = rowFor(coachId);
    r.clients = set.size;
    for (const k of set) {
      if ((lastAt.get(k) ?? 0) < quietBefore) r.quietClients++;
      if (lowBalance.has(k)) r.lowBalanceClients++;
    }
  }

  const sessionLines: SessionLine[] = [];
  for (const b of bookings.rows) {
    const r = rowFor(b.coach_id);
    if (b.status === "cancelled") {
      if (b.late_cancel) r.lateCancels++;
      continue;
    }
    if (b.no_show) {
      r.noShows++;
      continue;
    }
    if (b.status === "confirmed" && new Date(b.start_at).getTime() <= now.getTime()) {
      r.sessionsDelivered++;
      sessionLines.push({ bookingId: b.id, coachId: b.coach_id, coachName: r.name, startAt: b.start_at, clientName: clientName.get(b.athlete_id) ?? "Client", sessionType: b.session_type ?? "" });
    }
  }
  sessionLines.sort((a, b) => a.coachName.localeCompare(b.coachName) || a.startAt.localeCompare(b.startAt));

  return {
    rows: [...stats.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sessionLines,
    creditsSold: purchases.rows.reduce((n, p) => n + (Number(p.credits_purchased) || 0), 0),
    failed,
    truncated,
  };
}

// The payroll estimate for one coach: sessions delivered times the rate the owner types (in cents per session). An estimate to check against pay, not payroll.
export function estimateCents(sessionsDelivered: number, rateCentsPerSession: number): number {
  if (!Number.isFinite(rateCentsPerSession) || rateCentsPerSession < 0) return 0;
  return Math.round(sessionsDelivered * rateCentsPerSession);
}
