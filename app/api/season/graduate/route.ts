import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { buildTextPdf } from "@/lib/simple-pdf";
import { graduationEmail, hasGraduatedBy, historyLines } from "@/lib/graduation";
import { pageAll } from "@/lib/page-all";
import { loadTrainingHistory } from "@/lib/graduation-server";
import { sendGraduationHistories, type Claim } from "@/lib/graduation-send";

// After a coach starts next season: each player of the retired season whose class has graduated and who was NOT brought over is emailed a PDF of their own training history, once. The coach sends only the retired
// season's id; who is emailed is decided here from the records, never from the browser. The PDF goes to the player's own sign-in address and to nobody else (no coach, parent or copy), for a minor as for an adult.
// A player who cannot be sent to is LISTED with the reason (no address that can receive mail; a history too long or unreadable to send whole; a send that failed) so the coach can get it to them another way.
// Safe to call again, even twice at once: a player is claimed (a unique row) before anything is sent, so nobody is emailed twice, and a claim is given back if the send fails.
// At most this many players are emailed in one call (each takes a moment); the answer says how many are left and the same button sends the rest.
const PER_CALL = 40;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await rateLimitResponse("season-graduate", user.id, 20, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { groupId?: string; year?: number };
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  if (!groupId) return NextResponse.json({ error: "Missing the season." }, { status: 400 });
  // The year the coach's screen used to untick the graduating players (their own calendar year), so the screen and the server decide with ONE year. Only a plausible year is accepted.
  const serverYear = new Date().getUTCFullYear();
  const year = typeof body.year === "number" && Number.isInteger(body.year) && Math.abs(body.year - serverYear) <= 1 ? body.year : serverYear;

  // The caller must coach the retired season.
  const { data: seat } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (seat?.role !== "coach") return NextResponse.json({ error: "Only a coach of this season can do that." }, { status: 403 });

  const db = createServiceRoleClient();
  const { data: group } = await db.from("groups").select("name, group_kind, archived_at, next_season_id").eq("id", groupId).maybeSingle();
  if (!group || group.group_kind !== "team" || !group.archived_at || !group.next_season_id) {
    return NextResponse.json({ error: "That season has not been rolled over." }, { status: 400 });
  }
  if (!isEmailConfigured()) return NextResponse.json({ sent: 0, skipped: 0, problems: [], emailOff: true });

  // Players of the retired season whose class has graduated (by the year the season was retired) and who are not on next season's roster.
  const [oldRead, nextRead] = await Promise.all([
    pageAll((from, to) => db.from("group_memberships").select("id, profile_id, graduation_year, profiles ( full_name )").eq("group_id", groupId).eq("role", "athlete").not("graduation_year", "is", null).order("id").range(from, to), { maxPages: 50 }),
    pageAll((from, to) => db.from("group_memberships").select("id, profile_id").eq("group_id", group.next_season_id).eq("role", "athlete").order("id").range(from, to), { maxPages: 50 }),
  ]);
  if (oldRead.failed || nextRead.failed || oldRead.truncated || nextRead.truncated) return NextResponse.json({ error: "Couldn't read the roster. Try again." }, { status: 502 });

  const staying = new Set(nextRead.rows.map((r: { profile_id: string }) => r.profile_id));
  const allGraduates = (oldRead.rows as unknown as { profile_id: string; graduation_year: number; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).filter(
    (r) => hasGraduatedBy(r.graduation_year, year) && !staying.has(r.profile_id)
  );
  // The cap is on this call's work, not on the roster: the rest are counted and the same button sends them.
  const graduates = allGraduates.slice(0, PER_CALL);
  const remaining = allGraduates.length - graduates.length;

  const preparedOn = new Date().toISOString().slice(0, 10);
  const teamName = (group.name as string) || "your team";
  const nameOf = (g: (typeof graduates)[number]) => {
    const profile = Array.isArray(g.profiles) ? g.profiles[0] : g.profiles;
    return profile?.full_name?.trim() || "A player";
  };
  const byId = new Map(graduates.map((g) => [g.profile_id, g]));
  const STALE_MS = 10 * 60 * 1000;

  const result = await sendGraduationHistories(
    graduates.map((g) => ({ id: g.profile_id, name: nameOf(g) })),
    {
      async addressOf(id) {
        const { data: auth } = await db.auth.admin.getUserById(id);
        const to = auth?.user?.email ?? "";
        return !to || isPlaceholderEmail(to) ? null : to;
      },
      // A unique row per season and player, made BEFORE the email goes. A row that was claimed but never stamped sent within ten minutes (the server died mid-send) can be taken over.
      async claim(id): Promise<Claim> {
        const { error } = await db.from("graduation_exports").insert({ group_id: groupId, athlete_id: id });
        if (!error) return "claimed";
        if (error.code !== "23505") return "error";
        const { data: row } = await db.from("graduation_exports").select("claimed_at, sent_at").eq("group_id", groupId).eq("athlete_id", id).maybeSingle();
        const existing = row as { claimed_at: string; sent_at: string | null } | null;
        if (!existing || existing.sent_at || Date.now() - new Date(existing.claimed_at).getTime() < STALE_MS) return "taken";
        const { data: took } = await db
          .from("graduation_exports")
          .update({ claimed_at: new Date().toISOString() })
          .eq("group_id", groupId)
          .eq("athlete_id", id)
          .is("sent_at", null)
          .eq("claimed_at", existing.claimed_at)
          .select("athlete_id");
        return (took ?? []).length > 0 ? "claimed" : "taken";
      },
      async release(id) {
        await db.from("graduation_exports").delete().eq("group_id", groupId).eq("athlete_id", id).is("sent_at", null);
      },
      async markSent(id) {
        await db.from("graduation_exports").update({ sent_at: new Date().toISOString() }).eq("group_id", groupId).eq("athlete_id", id);
      },
      history: (id) => loadTrainingHistory(db, id),
      async weightUnit(id) {
        const { data: details } = await db.from("athlete_profile_details").select("weight_unit").eq("athlete_id", id).maybeSingle();
        return (details as { weight_unit?: string } | null)?.weight_unit === "kg" ? "kg" : "lb";
      },
      async send(to, athlete, sessions, unit) {
        const fullName = byId.get(athlete.id) ? nameOf(byId.get(athlete.id)!) : athlete.name;
        const pdf = buildTextPdf("Your training history", historyLines({ fullName, teamName, unit, sessions, preparedOn }));
        const mail = graduationEmail({ firstName: fullName.split(/\s+/)[0] || "there", teamName });
        return sendEmail(to, mail.subject, mail.text, { name: "training-history.pdf", bytes: pdf });
      },
    }
  );
  return NextResponse.json({ ...result, remaining });
}
