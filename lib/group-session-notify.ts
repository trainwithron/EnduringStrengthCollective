import { sendPushToProfile } from "@/lib/send-push";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

// Tells people what happened to a class they are in. One push each, in the coach's time zone, linking to their classes page.
// Never blocks: the change already happened. `db` is the service-role client.
async function classInfo(db: any, sessionId: string): Promise<{ title: string; when: string; coachName: string } | null> {
  const { data } = await db.from("group_sessions").select("title, start_at, coach_id").eq("id", sessionId).maybeSingle();
  if (!data) return null;
  const { data: coach } = await db.from("profiles").select("full_name, timezone").eq("id", data.coach_id).maybeSingle();
  return {
    title: data.title,
    when: formatInTimezone(new Date(data.start_at), coach?.timezone ?? DEFAULT_COACH_TIMEZONE, "dateTime"),
    coachName: coach?.full_name ?? "Your coach",
  };
}

async function classesLink(db: any, sessionId: string, athleteId: string): Promise<string> {
  const { data } = await db.from("group_session_attendees").select("group_id").eq("group_session_id", sessionId).eq("athlete_id", athleteId).maybeSingle();
  return data?.group_id ? `/groups/${data.group_id}/classes` : "/";
}

export async function notifyPromoted(db: any, sessionId: string, athleteIds: string[]): Promise<void> {
  if (athleteIds.length === 0) return;
  try {
    const info = await classInfo(db, sessionId);
    if (!info) return;
    for (const id of athleteIds) {
      await sendPushToProfile(db, id, "A spot opened up", `You're in: ${info.title}, ${info.when}.`, await classesLink(db, sessionId, id)).catch(() => 0);
    }
  } catch {
    // Quiet.
  }
}

export async function notifyCancelled(db: any, sessionId: string, athleteIds: string[]): Promise<void> {
  if (athleteIds.length === 0) return;
  try {
    const info = await classInfo(db, sessionId);
    if (!info) return;
    for (const id of athleteIds) {
      await sendPushToProfile(
        db,
        id,
        "Class cancelled",
        `${info.coachName} cancelled ${info.title} on ${info.when}. Any session you used was returned.`,
        await classesLink(db, sessionId, id)
      ).catch(() => 0);
    }
  } catch {
    // Quiet.
  }
}
