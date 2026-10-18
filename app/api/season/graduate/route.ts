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
// season's id; who is emailed is decided here from the records, never from the browser: the year that decides "graduated" is the one stored on the retired season WHEN IT WAS RETIRED (groups.graduates_through; for a
// season retired before that existed, the UTC year it was retired in), so pressing the button months later, or sending a made-up year, never adds anyone. The PDF goes to the player's own sign-in address and to
// nobody else (no coach, parent or copy), for a minor as for an adult.
// A player who cannot be sent to is LISTED with the reason (no address that can receive mail; a history too long or unreadable to send whole; a send that failed) so the coach can get it to them another way.
// At most once: a player is claimed (a unique row) before anything is sent, stamped sent afterwards, and a claim that was never stamped is NEVER taken over automatically. It is listed as "may already have been sent",
// and only the coach can choose "Send anyway" for that player. A duplicate email is worse than asking the coach.
// At most this many players are emailed in one call (each takes a moment); the answer says how many are left and the same button sends the rest.
const PER_CALL = 40;
// A claim made this recently is a send in progress, not a doubtful one.
const IN_FLIGHT_MS = 10 * 60 * 1000;
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await rateLimitResponse("season-graduate", user.id, 20, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { groupId?: string; sendAnyway?: string };
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  if (!groupId) return NextResponse.json({ error: "Missing the season." }, { status: 400 });
  const sendAnyway = typeof body.sendAnyway === "string" ? body.sendAnyway : null;

  // The caller must coach the retired season.
  const { data: seat } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (seat?.role !== "coach") return NextResponse.json({ error: "Only a coach of this season can do that." }, { status: 403 });

  const db = createServiceRoleClient();
  const { data: group } = await db.from("groups").select("name, group_kind, archived_at, next_season_id, graduates_through").eq("id", groupId).maybeSingle();
  if (!group || group.group_kind !== "team" || !group.archived_at || !group.next_season_id) {
    return NextResponse.json({ error: "That season has not been rolled over." }, { status: 400 });
  }
  if (!isEmailConfigured()) return NextResponse.json({ sent: 0, skipped: 0, problems: [], uncertain: [], remaining: 0, emailOff: true });

  // The one year that decides who has graduated, fixed when the season was retired.
  const year = typeof group.graduates_through === "number" ? group.graduates_through : new Date(group.archived_at as string).getUTCFullYear();

  // Players of the retired season whose class has graduated and who are not on next season's roster.
  const [oldRead, nextRead, exportRead] = await Promise.all([
    pageAll((from, to) => db.from("group_memberships").select("id, profile_id, graduation_year, profiles ( full_name )").eq("group_id", groupId).eq("role", "athlete").not("graduation_year", "is", null).order("id").range(from, to), { maxPages: 50 }),
    pageAll((from, to) => db.from("group_memberships").select("id, profile_id").eq("group_id", group.next_season_id).eq("role", "athlete").order("id").range(from, to), { maxPages: 50 }),
    pageAll((from, to) => db.from("graduation_exports").select("athlete_id, claimed_at, sent_at").eq("group_id", groupId).order("athlete_id").range(from, to), { maxPages: 50 }),
  ]);
  if (oldRead.failed || nextRead.failed || oldRead.truncated || nextRead.truncated || exportRead.failed || exportRead.truncated) return NextResponse.json({ error: "Couldn't read the roster. Try again." }, { status: 502 });

  const staying = new Set(nextRead.rows.map((r: { profile_id: string }) => r.profile_id));
  const exports = exportRead.rows as { athlete_id: string; claimed_at: string; sent_at: string | null }[];
  const nowMs = Date.now();
  const sentIds = new Set(exports.filter((r) => r.sent_at).map((r) => r.athlete_id));
  // Claimed but never stamped: in progress (recent) or doubtful (older). Neither is touched automatically.
  const inFlightIds = new Set(exports.filter((r) => !r.sent_at && nowMs - new Date(r.claimed_at).getTime() < IN_FLIGHT_MS).map((r) => r.athlete_id));
  const doubtfulIds = new Set(exports.filter((r) => !r.sent_at && nowMs - new Date(r.claimed_at).getTime() >= IN_FLIGHT_MS).map((r) => r.athlete_id));

  const allGraduates = (oldRead.rows as unknown as { profile_id: string; graduation_year: number; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).filter(
    (r) => hasGraduatedBy(r.graduation_year, year) && !staying.has(r.profile_id)
  );
  const nameOf = (g: (typeof allGraduates)[number]) => {
    const profile = Array.isArray(g.profiles) ? g.profiles[0] : g.profiles;
    return profile?.full_name?.trim() || "A player";
  };
  const uncertain = allGraduates.filter((r) => doubtfulIds.has(r.profile_id)).map((r) => ({ id: r.profile_id, name: nameOf(r) }));

  // The coach chose "Send anyway" for a player whose earlier send is doubtful: only for a player who really is on that list; the doubtful claim is cleared and that one player is sent.
  let graduates = allGraduates.filter((r) => !sentIds.has(r.profile_id) && !inFlightIds.has(r.profile_id) && !doubtfulIds.has(r.profile_id));
  let alreadyHandled = allGraduates.length - graduates.length;
  if (sendAnyway) {
    const target = allGraduates.find((r) => r.profile_id === sendAnyway && doubtfulIds.has(r.profile_id));
    if (!target) return NextResponse.json({ error: "That player is not waiting on a decision." }, { status: 400 });
    await db.from("graduation_exports").delete().eq("group_id", groupId).eq("athlete_id", sendAnyway).is("sent_at", null);
    graduates = [target];
    alreadyHandled = 0;
  }

  const preparedOn = new Date().toISOString().slice(0, 10);
  const teamName = (group.name as string) || "your team";
  const byId = new Map(graduates.map((g) => [g.profile_id, g]));

  const result = await sendGraduationHistories(
    graduates.map((g) => ({ id: g.profile_id, name: nameOf(g) })),
    {
      async addressOf(id) {
        const { data: auth } = await db.auth.admin.getUserById(id);
        const to = auth?.user?.email ?? "";
        return !to || isPlaceholderEmail(to) ? null : to;
      },
      // A unique row per season and player, made BEFORE the email goes. Any existing row means someone else has this player.
      async claim(id): Promise<Claim> {
        const { error } = await db.from("graduation_exports").insert({ group_id: groupId, athlete_id: id });
        if (!error) return "claimed";
        return error.code === "23505" ? "taken" : "error";
      },
      async release(id) {
        await db.from("graduation_exports").delete().eq("group_id", groupId).eq("athlete_id", id).is("sent_at", null);
      },
      // Errors from the database are returned, not thrown: check them, so a failed stamp is retried and logged.
      async markSent(id) {
        const { error } = await db.from("graduation_exports").update({ sent_at: new Date().toISOString() }).eq("group_id", groupId).eq("athlete_id", id);
        if (error) throw new Error(error.message);
      },
      history: (id) => loadTrainingHistory(db, id),
      async weightUnit(id) {
        const { data: details } = await db.from("athlete_profile_details").select("weight_unit").eq("athlete_id", id).maybeSingle();
        return (details as { weight_unit?: string } | null)?.weight_unit === "kg" ? "kg" : "lb";
      },
      async send(to, athlete, sessions, unit) {
        const found = byId.get(athlete.id);
        const fullName = found ? nameOf(found) : athlete.name;
        const pdf = buildTextPdf("Your training history", historyLines({ fullName, teamName, unit, sessions, preparedOn }));
        const mail = graduationEmail({ firstName: fullName.split(/\s+/)[0] || "there", teamName });
        return sendEmail(to, mail.subject, mail.text, { name: "training-history.pdf", bytes: pdf });
      },
    },
    { limit: PER_CALL }
  );
  return NextResponse.json({ ...result, skipped: result.skipped + alreadyHandled, uncertain: sendAnyway ? uncertain.filter((u) => u.id !== sendAnyway) : uncertain });
}
