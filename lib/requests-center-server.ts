import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { countByIds, readRowsByIds } from "@/lib/read-by-ids";
import {
  ANSWERED_DAYS,
  answeredBooking,
  answeredClient,
  answeredLate,
  answeredSchedule,
  closestByTime,
  isUuid,
  sortAnswered,
  type AnsweredRequest,
  type BookingRequestRow,
  type LateChangeRow,
  type RequestKind,
  type ScheduleRequestRow,
} from "@/lib/requests-center";
import type { RequestRow } from "@/components/coach/client-requests-panel";

// What the Requests page reads on the server: the waiting client requests (every organization the coach belongs to, as before), what was answered in the last 30 days (sessions, late changes and
// schedule changes in the OPEN organization; client requests in every organization), and which request a notice is about. The waiting sessions, late changes and schedule changes are read by the
// same panels Home shows (LateChangesPanel, ScheduleRequestsPanel), so they are decided exactly as they are there.

export const BOOKING_REQUEST_SELECT = "id, kind, status, from_start_at, new_start_at, decided_at, created_at, group_id, profiles!booking_requests_athlete_id_fkey ( full_name )";
export const LATE_CHANGE_SELECT = "id, start_at, late_change_kind, late_charge_state, group_id, profiles!bookings_athlete_id_fkey ( full_name )";
export const SCHEDULE_REQUEST_SELECT =
  "id, kind, status, effective_on, resume_on, applied_at, applied_early, dismissed_at, withdrawn_at, created_at, group_id, profiles!schedule_requests_athlete_id_fkey ( full_name ), recurring_booking_series ( weekday, start_time, duration_minutes )";

// schedule_applied: the coach's copy of "the change was applied" (on the day, by the app), found by the moment it was applied.
const REQUEST_NOTICE_KIND: Record<string, RequestKind> = { booking_request: "booking", late_change: "late", schedule_request: "schedule", schedule_applied: "schedule", client_request: "client" };

export interface RequestsCenterData {
  clients: RequestRow[];
  answered: AnsweredRequest[];
  waitingCount: number;
  focus: { kind: RequestKind; id: string } | null;
  failed: boolean;
}

export async function loadRequestsCenter(
  supabase: SupabaseClient,
  opts: { userId: string; orgGroupIds: string[]; timezone: string; focus: { kind: RequestKind; id: string } | null; noticeId: string | null; now?: Date }
): Promise<RequestsCenterData> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - ANSWERED_DAYS * 86400000).toISOString();
  const nowIso = now.toISOString();
  const inOrg = new Set(opts.orgGroupIds);
  const tz = opts.timezone;
  let failed = false;

  // Every organization the coach belongs to, for client requests (a request goes to the organization the coach's public page belongs to, which may not be the open one).
  const memberRes = await supabase.from("organization_memberships").select("organization_id, organizations ( name )").eq("profile_id", opts.userId);
  if (memberRes.error) failed = true;
  const orgs = ((memberRes.data ?? []) as unknown as { organization_id: string; organizations: { name: string | null } | { name: string | null }[] | null }[]).map((m) => ({
    id: m.organization_id,
    name: (Array.isArray(m.organizations) ? m.organizations[0]?.name : m.organizations?.name) ?? null,
  }));
  const orgLabel = (name: string | null) => (orgs.length > 1 ? name : null);

  // The open organization's groups, inside each query (a coach in several organizations sees only this one's here); the ids go in groups of 100 (lib/read-by-ids.ts).
  const ids = opts.orgGroupIds;
  const page = { pageSize: 200, maxPages: 1 };
  const [bookingsDecided, bookingsLapsed, lates, schedules, clientLists, waitingCounts] = await Promise.all([
    readRowsByIds(ids, (g) => (from, to) =>
      supabase.from("booking_requests").select(BOOKING_REQUEST_SELECT).eq("coach_id", opts.userId).in("group_id", g).neq("status", "pending").gte("decided_at", since).order("decided_at", { ascending: false }).order("id").range(from, to), page),
    // asked for and never answered before the time came: closed by the time passing
    readRowsByIds(ids, (g) => (from, to) =>
      supabase.from("booking_requests").select(BOOKING_REQUEST_SELECT).eq("coach_id", opts.userId).in("group_id", g).eq("status", "pending").lte("new_start_at", nowIso).gte("new_start_at", since).order("new_start_at", { ascending: false }).order("id").range(from, to), page),
    readRowsByIds(ids, (g) => (from, to) =>
      supabase.from("bookings").select(LATE_CHANGE_SELECT).eq("coach_id", opts.userId).in("group_id", g).in("late_charge_state", ["charged", "waived"]).gte("start_at", since).order("start_at", { ascending: false }).order("id").range(from, to), page),
    // the schedule changes of the open organization's groups the coach coaches (as Home's schedule panel shows them)
    readRowsByIds(ids, (g) => (from, to) =>
      supabase
        .from("schedule_requests")
        .select(SCHEDULE_REQUEST_SELECT)
        .in("group_id", g)
        .in("status", ["applied", "dismissed", "withdrawn"])
        .or(`applied_at.gte.${since},dismissed_at.gte.${since},withdrawn_at.gte.${since}`)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to), page),
    Promise.all(
      orgs.flatMap((o) =>
        (["pending", "approved", "declined"] as const).map(async (status) => ({ org: o, status, res: await supabase.rpc("coach_client_requests", { p_status: status, p_org: o.id }) }))
      )
    ),
    Promise.all([
      countByIds(ids, (g) => supabase.from("booking_requests").select("id", { count: "exact", head: true }).eq("coach_id", opts.userId).in("group_id", g).eq("status", "pending").gt("new_start_at", nowIso)),
      countByIds(ids, (g) => supabase.from("bookings").select("id", { count: "exact", head: true }).eq("coach_id", opts.userId).in("group_id", g).eq("late_charge_state", "flagged")),
      countByIds(ids, (g) => supabase.from("schedule_requests").select("id", { count: "exact", head: true }).in("group_id", g).in("status", ["pending", "applying"])),
    ]),
  ]);
  for (const r of [bookingsDecided, bookingsLapsed, lates, schedules]) if (r.error) failed = true;
  if (clientLists.some((c) => !!c.res.error)) failed = true;

  type ClientListRow = { id: string; display_name: string; created_at: string; status: string; email_confirmed?: boolean | null };
  const clients: RequestRow[] = clientLists
    .filter((c) => c.status === "pending")
    .flatMap(({ org, res }) =>
      ((res.data ?? []) as ClientListRow[]).map((r) => ({
        id: r.id,
        name: r.display_name,
        organizationId: org.id,
        organizationName: orgLabel(org.name),
        createdAt: r.created_at,
        emailConfirmed: r.email_confirmed !== false,
      }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // A client request's decision time: the coach cannot read that table itself (only through coach_client_requests, which says who and when asked), so the server reads decided_at for the
  // requests that function already returned for this coach.
  const decidedClients = clientLists.filter((c) => c.status !== "pending").flatMap(({ org, res }) => ((res.data ?? []) as ClientListRow[]).map((r) => ({ ...r, orgName: org.name })));
  const decidedAt = new Map<string, string | null>();
  if (decidedClients.length > 0) {
    const db = createServiceRoleClient();
    const { data, error } = await db.from("client_requests").select("id, decided_at").eq("coach_id", opts.userId).in("id", decidedClients.map((c) => c.id).slice(0, 600));
    if (error) failed = true;
    for (const r of (data ?? []) as { id: string; decided_at: string | null }[]) decidedAt.set(r.id, r.decided_at);
  }

  const answered: AnsweredRequest[] = [
    ...[...((bookingsDecided.data ?? []) as any[]), ...((bookingsLapsed.data ?? []) as any[])].filter((r) => inOrg.has(r.group_id)).map((r) => answeredBooking(r as BookingRequestRow, tz)),
    ...((lates.data ?? []) as any[]).filter((r) => inOrg.has(r.group_id)).map((r) => answeredLate(r as LateChangeRow, tz)),
    ...((schedules.data ?? []) as any[]).filter((r) => inOrg.has(r.group_id)).map((r) => answeredSchedule(r as ScheduleRequestRow)),
    ...decidedClients
      .map((c) => ({ ...c, decided_at: decidedAt.get(c.id) ?? null }))
      .filter((c) => (c.decided_at ?? c.created_at) >= since)
      .map((c) => answeredClient(c, orgLabel(c.orgName))),
  ];

  // Which request the page opens at: named outright (?focus=booking:<id>), or the request a notice is about (?notice=<id>, every request notice and every older one that said "/dashboard").
  let focus = opts.focus;
  if (!focus && opts.noticeId) focus = await requestForNotice(supabase, opts.userId, opts.noticeId);
  // A request that is neither waiting nor in the last 30 days (an older one, or another organization's) is still shown, in the answered list, so a notice never opens on nothing.
  if (focus && focus.kind !== "client" && !answered.some((a) => a.kind === focus!.kind && a.id === focus!.id)) {
    const one = await readOneAnswered(supabase, opts.userId, focus, tz, nowIso);
    if (one) answered.push(one);
  }

  const waitingCount = clients.length + waitingCounts.reduce((sum, c) => sum + c.count, 0);
  return { clients, answered: sortAnswered(answered), waitingCount, focus, failed };
}

/** The request a request notice is about. The notices carry no request id (the database writes "/dashboard" or a list page), so it is found by who it went to, the group, and the moment it was
 *  written; a late change (no time of its own on the booking) by the flagged session nearest after the notice. Null when it is not one of the coach's own request notices. */
export async function requestForNotice(supabase: SupabaseClient, userId: string, noticeId: string): Promise<{ kind: RequestKind; id: string } | null> {
  if (!isUuid(noticeId)) return null;
  const { data: n } = await supabase.from("notifications").select("id, type, group_id, created_at").eq("id", noticeId).eq("profile_id", userId).maybeSingle();
  const kind = n ? REQUEST_NOTICE_KIND[(n as { type: string }).type] : undefined;
  if (!n || !kind) return null;
  const at = new Date((n as { created_at: string }).created_at).getTime();
  const lo = new Date(at - 5000).toISOString();
  const hi = new Date(at + 5000).toISOString();
  const groupId = (n as { group_id: string | null }).group_id;

  if (kind === "booking" || kind === "schedule") {
    const column = (n as { type: string }).type === "schedule_applied" ? "applied_at" : "created_at";
    let q = supabase
      .from(kind === "booking" ? "booking_requests" : "schedule_requests")
      .select(`id, ${column}`)
      .eq(kind === "booking" ? "coach_id" : "group_id", kind === "booking" ? userId : groupId ?? "")
      .gte(column, lo)
      .lte(column, hi)
      .limit(10);
    if (kind === "booking" && groupId) q = q.eq("group_id", groupId);
    if (kind === "schedule" && !groupId) q = q.eq("coach_id", userId);
    const { data } = await q;
    const rows = ((data ?? []) as Record<string, string>[]).map((r) => ({ id: r.id, created_at: r[column] }));
    const best = closestByTime(rows, (n as { created_at: string }).created_at);
    return best ? { kind, id: best.id } : null;
  }
  if (kind === "late") {
    let q = supabase
      .from("bookings")
      .select("id, start_at")
      .eq("coach_id", userId)
      .not("late_charge_state", "is", null)
      .gte("start_at", new Date(at - 3600000).toISOString())
      .lte("start_at", new Date(at + 14 * 86400000).toISOString())
      .order("start_at", { ascending: true })
      .limit(1);
    if (groupId) q = q.eq("group_id", groupId);
    const { data } = await q;
    const row = ((data ?? []) as { id: string }[])[0];
    return row ? { kind, id: row.id } : null;
  }
  // a client request: the coach reads that table only through the server (the row is the coach's own, matched to the coach's own notice)
  const db = createServiceRoleClient();
  const { data } = await db.from("client_requests").select("id, created_at").eq("coach_id", userId).gte("created_at", lo).lte("created_at", hi).limit(10);
  const best = closestByTime((data ?? []) as { id: string; created_at: string }[], (n as { created_at: string }).created_at);
  return best ? { kind, id: best.id } : null;
}

async function readOneAnswered(supabase: SupabaseClient, userId: string, focus: { kind: RequestKind; id: string }, tz: string, nowIso: string): Promise<AnsweredRequest | null> {
  if (focus.kind === "booking") {
    const { data } = await supabase.from("booking_requests").select(BOOKING_REQUEST_SELECT).eq("id", focus.id).eq("coach_id", userId).maybeSingle();
    // still waiting and still ahead: the panel above shows it
    if (!data || ((data as any).status === "pending" && (data as any).new_start_at > nowIso)) return null;
    return answeredBooking(data as unknown as BookingRequestRow, tz);
  }
  if (focus.kind === "late") {
    const { data } = await supabase.from("bookings").select(LATE_CHANGE_SELECT).eq("id", focus.id).eq("coach_id", userId).maybeSingle();
    if (!data || (data as any).late_charge_state === "flagged") return null;
    return answeredLate(data as unknown as LateChangeRow, tz);
  }
  if (focus.kind === "schedule") {
    const { data } = await supabase.from("schedule_requests").select(SCHEDULE_REQUEST_SELECT).eq("id", focus.id).maybeSingle();
    if (!data || ["pending", "applying"].includes((data as any).status)) return null;
    return answeredSchedule(data as unknown as ScheduleRequestRow);
  }
  return null;
}

/** The request notices on the notifications page that can still be answered there: a session still waiting (Confirm or Decline) and a person still waiting to train with the coach (Approve or
 *  Decline). Matched to their request the way the Requests page matches them. Anything else, or anything already answered, just opens the Requests page. */
export async function answerableNotices(
  supabase: SupabaseClient,
  userId: string,
  notices: { id: string; type: string; created_at: string }[],
  now: Date = new Date()
): Promise<Map<string, { kind: "booking" | "client"; requestId: string }>> {
  const out = new Map<string, { kind: "booking" | "client"; requestId: string }>();
  const bookingNotices = notices.filter((n) => n.type === "booking_request");
  const clientNotices = notices.filter((n) => n.type === "client_request");
  try {
    const [bookings, clients] = await Promise.all([
      bookingNotices.length > 0
        ? supabase.from("booking_requests").select("id, created_at").eq("coach_id", userId).eq("status", "pending").gt("new_start_at", now.toISOString()).order("created_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [] as { id: string; created_at: string }[] }),
      // the coach reads that table only through the server: the coach's own waiting requests
      clientNotices.length > 0
        ? createServiceRoleClient().from("client_requests").select("id, created_at").eq("coach_id", userId).eq("status", "pending").order("created_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [] as { id: string; created_at: string }[] }),
    ]);
    const match = (list: { id: string; created_at: string }[], n: { created_at: string }) => {
      const best = closestByTime(list, n.created_at);
      return best && Math.abs(new Date(best.created_at).getTime() - new Date(n.created_at).getTime()) <= 5000 ? best.id : null;
    };
    for (const n of bookingNotices) {
      const id = match((bookings.data ?? []) as { id: string; created_at: string }[], n);
      if (id) out.set(n.id, { kind: "booking", requestId: id });
    }
    for (const n of clientNotices) {
      const id = match((clients.data ?? []) as { id: string; created_at: string }[], n);
      if (id) out.set(n.id, { kind: "client", requestId: id });
    }
  } catch {
    // no buttons: the rows still open the Requests page
  }
  return out;
}
