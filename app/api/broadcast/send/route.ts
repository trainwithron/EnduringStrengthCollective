import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendPushToProfile } from "@/lib/send-push";
import { mergeFirstName, MAX_BROADCAST_LENGTH } from "@/lib/broadcast-merge";

const MAX_RECIPIENTS = 500;

interface Recipient {
  athleteId: string;
  groupId: string;
}

// Bulk announcement send. Goes to real people under the coach's name and
// can't be unsent, so: every recipient is re-validated here (never
// trusting the browser's list), the batch is recorded FIRST under a
// unique (coach, idempotency key) so a double-click or retry can never
// send twice, and every DM is inserted under the coach's OWN session —
// the existing direct_messages RLS (is_group_coach + athlete-in-group)
// is a second, independent wall against messaging anyone outside the
// groups they coach. In-app DM + push only; no SMS/email path exists
// here by design.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const template = typeof body?.template === "string" ? body.template.trim() : "";
  const rawRecipients: Recipient[] = Array.isArray(body?.recipients) ? body.recipients : [];

  if (!idempotencyKey) return NextResponse.json({ error: "Missing send key." }, { status: 400 });
  if (!template) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (template.length > MAX_BROADCAST_LENGTH) {
    return NextResponse.json({ error: `Keep it under ${MAX_BROADCAST_LENGTH} characters.` }, { status: 400 });
  }

  // One message per person, however many groups they share with this coach.
  const byAthlete = new Map<string, Recipient>();
  for (const r of rawRecipients) {
    if (typeof r?.athleteId === "string" && typeof r?.groupId === "string" && !byAthlete.has(r.athleteId)) {
      byAthlete.set(r.athleteId, { athleteId: r.athleteId, groupId: r.groupId });
    }
  }
  const recipients = [...byAthlete.values()];
  if (recipients.length === 0) return NextResponse.json({ error: "Pick at least one recipient." }, { status: 400 });
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Max ${MAX_RECIPIENTS} recipients per announcement.` }, { status: 400 });
  }

  const groupIds = [...new Set(recipients.map((r) => r.groupId))];

  // Caller must be a coach of every group involved.
  const { data: coachRows } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach")
    .in("group_id", groupIds);
  const coachedGroupIds = new Set((coachRows ?? []).map((r) => r.group_id as string));
  if (groupIds.some((g) => !coachedGroupIds.has(g))) {
    return NextResponse.json({ error: "You can only message clients in groups you coach." }, { status: 403 });
  }

  // Every (athlete, group) pair must be a real training-membership
  // athlete in that group; names come from here, never from the browser.
  const { data: memberRows } = await supabase
    .from("group_memberships")
    .select("group_id, profile_id, membership_type, profiles ( full_name )")
    .eq("role", "athlete")
    .in("group_id", groupIds)
    .in("profile_id", recipients.map((r) => r.athleteId));
  const memberByKey = new Map<string, { fullName: string | null; membershipType: string }>();
  for (const m of (memberRows ?? []) as any[]) {
    memberByKey.set(`${m.group_id}:${m.profile_id}`, {
      fullName: m.profiles?.full_name ?? null,
      membershipType: m.membership_type,
    });
  }
  const invalid = recipients.filter((r) => {
    const m = memberByKey.get(`${r.groupId}:${r.athleteId}`);
    return !m || m.membershipType !== "training";
  });
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: "Some recipients aren't training clients in a group you coach — nothing was sent." },
      { status: 400 }
    );
  }

  // Record the batch FIRST. A repeat of the same key hits the unique
  // constraint and sends nothing.
  const { data: batch, error: batchError } = await supabase
    .from("broadcast_batches")
    .insert({
      coach_id: user.id,
      idempotency_key: idempotencyKey,
      template,
      recipient_count: recipients.length,
    })
    .select("id")
    .single();
  if (batchError || !batch) {
    if (batchError?.code === "23505") {
      return NextResponse.json({ duplicate: true, sent: 0 });
    }
    return NextResponse.json({ error: "Couldn't start the send — nothing was sent." }, { status: 500 });
  }

  const messages = recipients.map((r) => ({
    group_id: r.groupId,
    sender_id: user.id,
    recipient_id: r.athleteId,
    body: mergeFirstName(template, memberByKey.get(`${r.groupId}:${r.athleteId}`)!.fullName),
    broadcast_batch_id: batch.id,
  }));

  // One statement: all delivered or none.
  const { error: insertError } = await supabase.from("direct_messages").insert(messages);
  if (insertError) {
    await supabase.from("broadcast_batches").update({ status: "failed" }).eq("id", batch.id);
    return NextResponse.json({ error: "Couldn't deliver the messages — nothing was sent." }, { status: 500 });
  }
  await supabase.from("broadcast_batches").update({ status: "sent" }).eq("id", batch.id);

  // Push is best-effort on top of the in-app DM (the unread badge already
  // surfaces it for anyone without push).
  const { data: coachProfile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const coachName = coachProfile?.full_name ?? "Your coach";
  let pushed = 0;
  for (const m of messages) {
    try {
      pushed += await sendPushToProfile(
        supabase,
        m.recipient_id,
        `New message from ${coachName}`,
        m.body.slice(0, 140),
        `/groups/${m.group_id}/messages/${user.id}`
      );
    } catch {
      // never let a push failure undo a delivered DM
    }
  }

  return NextResponse.json({ sent: messages.length, pushed, batchId: batch.id });
}
