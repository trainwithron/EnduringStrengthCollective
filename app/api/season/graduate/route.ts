import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { buildTextPdf } from "@/lib/simple-pdf";
import { graduationEmail, hasGraduated, historyLines } from "@/lib/graduation";
import { loadTrainingHistory } from "@/lib/graduation-server";

// After a coach starts next season: each player of the retired season whose class has graduated and who was NOT brought over is emailed a PDF of their own training history, once. The coach sends only the retired
// season's id; who is emailed is decided here from the records, never from the browser. The PDF goes to the player's own sign-in address and to nobody else (no coach, parent or copy), for a minor as for an adult.
// A player whose address cannot receive mail (a client set up by the coach who never signed in) is counted, not sent to. Safe to call again: a player already sent to is skipped.
const MAX_PLAYERS = 500;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await rateLimitResponse("season-graduate", user.id, 20, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { groupId?: string };
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  if (!groupId) return NextResponse.json({ error: "Missing the season." }, { status: 400 });

  // The caller must coach the retired season.
  const { data: seat } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (seat?.role !== "coach") return NextResponse.json({ error: "Only a coach of this season can do that." }, { status: 403 });

  const db = createServiceRoleClient();
  const { data: group } = await db.from("groups").select("name, group_kind, archived_at, next_season_id").eq("id", groupId).maybeSingle();
  if (!group || group.group_kind !== "team" || !group.archived_at || !group.next_season_id) {
    return NextResponse.json({ error: "That season has not been rolled over." }, { status: 400 });
  }
  if (!isEmailConfigured()) return NextResponse.json({ sent: 0, noEmail: 0, failed: 0, skipped: 0, emailOff: true });

  // Players of the retired season whose class has graduated (by the year the season was retired) and who are not on next season's roster.
  const retiredAt = new Date(group.archived_at as string);
  const [{ data: oldRows, error: oldError }, { data: nextRows, error: nextError }, { data: doneRows, error: doneError }] = await Promise.all([
    db.from("group_memberships").select("profile_id, graduation_year, profiles ( full_name )").eq("group_id", groupId).eq("role", "athlete").not("graduation_year", "is", null).limit(MAX_PLAYERS + 1),
    db.from("group_memberships").select("profile_id").eq("group_id", group.next_season_id).eq("role", "athlete").limit(5000),
    db.from("graduation_exports").select("athlete_id").eq("group_id", groupId),
  ]);
  if (oldError || nextError || doneError) return NextResponse.json({ error: "Couldn't read the roster. Try again." }, { status: 502 });
  if ((oldRows ?? []).length > MAX_PLAYERS) return NextResponse.json({ error: "Too many graduating players to send in one go." }, { status: 400 });

  const staying = new Set((nextRows ?? []).map((r: { profile_id: string }) => r.profile_id));
  const done = new Set((doneRows ?? []).map((r: { athlete_id: string }) => r.athlete_id));
  const graduates = ((oldRows ?? []) as unknown as { profile_id: string; graduation_year: number; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).filter(
    (r) => hasGraduated(r.graduation_year, retiredAt) && !staying.has(r.profile_id)
  );

  const preparedOn = new Date().toISOString().slice(0, 10);
  let sent = 0;
  let noEmail = 0;
  let failed = 0;
  let skipped = 0;
  for (const g of graduates) {
    if (done.has(g.profile_id)) {
      skipped++;
      continue;
    }
    try {
      const { data: auth } = await db.auth.admin.getUserById(g.profile_id);
      const to = auth?.user?.email ?? "";
      if (!to || isPlaceholderEmail(to)) {
        noEmail++;
        continue;
      }
      const history = await loadTrainingHistory(db, g.profile_id);
      // A history that could not be read in full is not sent as if it were whole.
      if (history.failed || history.truncated) {
        failed++;
        continue;
      }
      const { data: details } = await db.from("athlete_profile_details").select("weight_unit").eq("athlete_id", g.profile_id).maybeSingle();
      const unit = (details as { weight_unit?: string } | null)?.weight_unit === "kg" ? "kg" : "lb";
      const profile = Array.isArray(g.profiles) ? g.profiles[0] : g.profiles;
      const fullName = profile?.full_name?.trim() || "Your training history";
      const teamName = (group.name as string) || "your team";
      const pdf = buildTextPdf("Your training history", historyLines({ fullName, teamName, unit, sessions: history.sessions, preparedOn }));
      const mail = graduationEmail({ firstName: fullName.split(/\s+/)[0] || "there", teamName });
      const ok = await sendEmail(to, mail.subject, mail.text, { name: "training-history.pdf", bytes: pdf });
      if (!ok) {
        failed++;
        continue;
      }
      const { error: markError } = await db.from("graduation_exports").insert({ group_id: groupId, athlete_id: g.profile_id });
      if (markError) console.error("[graduate] sent, but could not record it:", markError.message);
      sent++;
    } catch {
      failed++;
    }
  }
  return NextResponse.json({ sent, noEmail, failed, skipped });
}
