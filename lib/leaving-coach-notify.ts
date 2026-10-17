import { isEmailConfigured, sendEmail } from "@/lib/email";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { sendPushToProfile } from "@/lib/send-push";
import { EXPORT_LINK_DAYS, WINDOW_DAYS } from "@/lib/leaving-coach-policy";

// The plain transactional messages for a coach who is leaving, and for the clients of a coach whose account closed. Each is a notice in the app plus an email to the address on the account when email is set up;
// a failure of one never stops the other, and the caller decides whether a step counts as sent. Never marketing: only what the person needs to act on.
async function emailOf(db: any, profileId: string): Promise<string | null> {
  try {
    const { data } = await db.auth.admin.getUserById(profileId);
    const to = data?.user?.email as string | undefined;
    return to && !isPlaceholderEmail(to) ? to : null;
  } catch {
    return null;
  }
}

async function tell(db: any, args: { profileId: string; type: "coach_departure_reminder" | "coach_account_closed"; subject: string; body: string; linkPath: string; origin: string; emailToo?: boolean }): Promise<boolean> {
  let delivered = false;
  const { error } = await db.from("notifications").insert({ profile_id: args.profileId, type: args.type, body: args.body, link_path: args.linkPath });
  if (error) console.error(`[leaving-coach] notice (${args.type}) was refused:`, error.message);
  else delivered = true;
  await sendPushToProfile(db, args.profileId, args.subject, args.body, args.linkPath).catch(() => 0);
  if (args.emailToo !== false && isEmailConfigured()) {
    const to = await emailOf(db, args.profileId);
    if (to) {
      const ok = await sendEmail(to, args.subject, `${args.body}\n\n${args.origin}${args.linkPath}\n\nYou are getting this because it is about your account on Spotlight Coaching.`).catch(() => false);
      delivered = delivered || ok;
    }
  }
  return delivered;
}

const dateWord = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export const tellCoachTheyAreLeaving = (db: any, a: { coachId: string; orgName: string; endsAt: Date; origin: string }) =>
  tell(db, {
    profileId: a.coachId,
    type: "coach_departure_reminder",
    subject: `You are leaving ${a.orgName}`,
    body: `You are leaving ${a.orgName}. Your clients are still with you and you can keep coaching them for ${WINDOW_DAYS} days, until ${dateWord(a.endsAt)}. Before then, choose: start your own account (your clients and everything move with you), or export everything you have. After that your coaching access ends.`,
    linkPath: "/dashboard",
    origin: a.origin,
  });

export const remindCoach = (db: any, a: { coachId: string; orgName: string; daysLeft: number; endsAt: Date; origin: string }) =>
  tell(db, {
    profileId: a.coachId,
    type: "coach_departure_reminder",
    subject: `${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} left to choose`,
    body: `${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} left. Your coaching access with ${a.orgName} ends on ${dateWord(a.endsAt)}. Start your own account to keep your clients and everything, or export what you have.`,
    linkPath: "/dashboard",
    origin: a.origin,
  });

export const sendCoachTheirExport = (db: any, a: { coachId: string; orgName: string; fired: boolean; origin: string; couldNotStore?: boolean; nothingToExport?: boolean }) =>
  tell(db, {
    profileId: a.coachId,
    type: "coach_departure_reminder",
    subject: a.nothingToExport ? "Your coaching access has ended" : a.couldNotStore ? "Your export" : "Your export is ready",
    body: a.nothingToExport
      ? `${a.fired ? `Your coaching access with ${a.orgName} has ended.` : `Your ${WINDOW_DAYS} days with ${a.orgName} are over and your coaching access has ended.`} You had no clients to take with you, so there is nothing to export.`
      : `${a.fired ? `Your coaching access with ${a.orgName} has ended.` : `Your ${WINDOW_DAYS} days with ${a.orgName} are over and your coaching access has ended.`} Everything for the clients you kept is in one download: clients, programs, workouts, sets, bookings, credits and notes. ${a.couldNotStore ? "It is too large to prepare ahead, so it is made when you open the link, and that can take a few minutes. If it does not finish, write to support. " : ""}The link needs you to sign in, and it works for ${EXPORT_LINK_DAYS} days.`,
    linkPath: a.nothingToExport ? "/dashboard" : "/api/coach/exit-export",
    origin: a.origin,
  });

// The clients are told in the app (and by push); an email goes only to someone known to be an adult (a minor's or unknown-age login address is never written to).
export const tellClientCoachClosed = (db: any, a: { clientId: string; origin: string; emailToo: boolean }) =>
  tell(db, {
    emailToo: a.emailToo,
    profileId: a.clientId,
    type: "coach_account_closed",
    subject: "Your coach's account has closed",
    body: "Your coach's account has closed. You can keep logging your workouts, and nothing of yours was deleted. You can download all of your own data any time.",
    linkPath: "/api/account/export",
    origin: a.origin,
  });
