import { sendPushToProfile } from "@/lib/send-push";

// A coach is told when a client pays: a notice in the app and a push. Best effort and silent on failure: the payment is already recorded, and a notice that fails must never make Stripe retry the event.
// One notice per coach seat of the group; the client's name is in the text, which a person who wants private lock screens turns off (sendPushToProfile).
export async function notifyPaymentReceived(
  db: any,
  args: { groupId: string; athleteId: string; amountCents: number; what: string }
): Promise<{ coaches: number }> {
  try {
    const [{ data: seats }, { data: athlete }] = await Promise.all([
      db.from("group_memberships").select("profile_id").eq("group_id", args.groupId).eq("role", "coach"),
      db.from("profiles").select("full_name").eq("id", args.athleteId).maybeSingle(),
    ]);
    const coachIds = [...new Set(((seats ?? []) as { profile_id: string }[]).map((s) => s.profile_id).filter((id) => id !== args.athleteId))];
    if (coachIds.length === 0) return { coaches: 0 };
    const name = (athlete as { full_name?: string } | null)?.full_name ?? "A client";
    const dollars = (args.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
    const body = `${name} paid ${dollars}${args.what ? ` for ${args.what}` : ""}.`;
    const link = `/groups/${args.groupId}/business`;
    // The notice in the app has the details; the phone's lock screen does not (a client's name and an amount are not for anyone who glances at the phone).
    const lockScreenBody = "Open the app to see who paid.";
    for (const coachId of coachIds) {
      const { error } = await db.from("notifications").insert({ profile_id: coachId, group_id: args.groupId, type: "payment_received", body, link_path: link, pushed_at: new Date().toISOString() });
      if (error) console.error("[payment notice] the notification was refused:", error.message);
      await sendPushToProfile(db, coachId, "Payment received", lockScreenBody, link).catch(() => 0);
    }
    return { coaches: coachIds.length };
  } catch (e) {
    console.error("[payment notice] failed:", e instanceof Error ? e.message : e);
    return { coaches: 0 };
  }
}
