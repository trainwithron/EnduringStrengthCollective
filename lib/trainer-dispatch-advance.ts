import type { SupabaseClient } from "@supabase/supabase-js";
import { findAndRankAvailableTrainers } from "./trainer-dispatch-gather";
import { computeStepExpiry, findMatchingSlotForTrainer, resolveLocalDateForInstant, type GoalType } from "./trainer-dispatch";
import { resolveBlockedRangesForDate, type AvailabilityWindow } from "./booking-slots";
import { sendPushToProfile } from "./send-push";
import { sendEmail } from "./sendgrid";
import { DEFAULT_COACH_TIMEZONE } from "./timezone";

// org_calendar_spotter_trainer_dispatch_scoping_sept19.md — the I/O
// orchestration for the cascade itself: start it, advance it on
// decline/expiry, resolve it on accept. Called from the public submit
// route, the cron advance route, and the trainer's own accept/decline/
// ask-a-question routes — always with a service-role client, since
// ranking needs to read every trainer's own availability (RLS only
// ever grants a coach visibility into their OWN windows).

async function notifyOrgAdmins(
  supabase: SupabaseClient,
  organizationId: string,
  type: "trainer_dispatch_offer" | "trainer_dispatch_question",
  title: string,
  body: string,
  linkPath: string
) {
  const { data: admins } = await supabase
    .from("organization_memberships")
    .select("profile_id")
    .eq("organization_id", organizationId)
    .in("role", ["owner", "admin"]);
  for (const a of admins ?? []) {
    await supabase
      .from("notifications")
      .insert({ profile_id: a.profile_id, group_id: null, type, body, link_path: linkPath });
    await sendPushToProfile(supabase, a.profile_id, title, body, linkPath);
  }
}

// Creates the next cascade step for whichever available, not-yet-tried
// trainer ranks best, or resolves the request as unmatched if none are
// left. Safe to call repeatedly (idempotent against a request that's
// already left 'pending' — a prior accept/decline/no-trainer resolution
// is never overwritten).
export async function advanceDispatch(
  supabase: SupabaseClient,
  requestId: string
): Promise<{ status: "dispatched"; trainerId: string; stepId: string } | { status: "no_trainer_available" } | { status: "already_resolved" }> {
  const { data: request } = await supabase
    .from("org_trainer_dispatch_requests")
    .select("id, organization_id, prospect_name, requested_start_at, goal_type, status")
    .eq("id", requestId)
    .single();
  if (!request || request.status !== "pending") return { status: "already_resolved" };

  const { data: org } = await supabase
    .from("organizations")
    .select("dispatch_ttl_minutes")
    .eq("id", request.organization_id)
    .single();
  const ttlMinutes = org?.dispatch_ttl_minutes ?? 20;

  const { data: triedSteps } = await supabase
    .from("org_trainer_dispatch_steps")
    .select("trainer_id")
    .eq("request_id", requestId);
  const triedIds = new Set((triedSteps ?? []).map((s) => s.trainer_id));

  const ranked = await findAndRankAvailableTrainers(
    supabase,
    request.organization_id,
    new Date(request.requested_start_at),
    request.goal_type as GoalType
  );
  const next = ranked.find((r) => !triedIds.has(r.trainerId));

  if (!next) {
    await supabase
      .from("org_trainer_dispatch_requests")
      .update({ status: "no_trainer_available" })
      .eq("id", requestId);
    await notifyOrgAdmins(
      supabase,
      request.organization_id,
      "trainer_dispatch_offer",
      "No trainer available",
      `No trainer was available for ${request.prospect_name}'s request — reach out directly.`,
      "/dashboard"
    );
    return { status: "no_trainer_available" };
  }

  const expiresAt = computeStepExpiry(ttlMinutes);
  const { data: step } = await supabase
    .from("org_trainer_dispatch_steps")
    .insert({
      request_id: requestId,
      trainer_id: next.trainerId,
      rank: triedIds.size + 1,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  const linkPath = `/dispatch/${step!.id}`;
  const body = `${request.prospect_name} wants to train — respond within ${ttlMinutes} minutes.`;
  await supabase
    .from("notifications")
    .insert({ profile_id: next.trainerId, group_id: null, type: "trainer_dispatch_offer", body, link_path: linkPath });
  await sendPushToProfile(supabase, next.trainerId, "New client request", body, linkPath);

  return { status: "dispatched", trainerId: next.trainerId, stepId: step!.id };
}

// Marks every other pending/undispatched trace of this request closed
// out and creates the real booking. Reuses discovery_bookings — the
// exact same table the single-coach prospect flow already writes to —
// rather than inventing a second booking record for the same real-world
// event.
export async function acceptDispatchStep(supabase: SupabaseClient, stepId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: step } = await supabase
    .from("org_trainer_dispatch_steps")
    .select("id, trainer_id, status, request_id")
    .eq("id", stepId)
    .single();
  if (!step) return { ok: false, error: "Step not found." };
  if (step.status !== "pending") return { ok: false, error: "This request is no longer open." };

  const { data: request } = await supabase
    .from("org_trainer_dispatch_requests")
    .select("id, organization_id, prospect_name, prospect_email, prospect_phone, message, requested_start_at, status")
    .eq("id", step.request_id)
    .single();
  if (!request || request.status !== "pending") return { ok: false, error: "This request is no longer open." };

  const { data: trainerProfile } = await supabase
    .from("profiles")
    .select("full_name, timezone")
    .eq("id", step.trainer_id)
    .single();
  const timezone = trainerProfile?.timezone ?? DEFAULT_COACH_TIMEZONE;

  const requestedStartAt = new Date(request.requested_start_at);
  const { data: windowRows } = await supabase
    .from("coach_availability_windows")
    .select("weekday, start_time, end_time, slot_duration_minutes")
    .eq("coach_id", step.trainer_id);
  const windows: AvailabilityWindow[] = (windowRows ?? []).map((w) => ({
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
  }));
  const localDate = resolveLocalDateForInstant(requestedStartAt, timezone);
  const { data: exceptionRows } = await supabase
    .from("coach_availability_exceptions")
    .select("kind, start_at, end_at, weekday, start_time, end_time")
    .eq("coach_id", step.trainer_id);
  const blockedRanges = resolveBlockedRangesForDate(
    localDate,
    (exceptionRows ?? []).map((e) => ({
      kind: e.kind,
      startAt: e.start_at,
      endAt: e.end_at,
      weekday: e.weekday,
      startTime: e.start_time,
      endTime: e.end_time,
    })),
    timezone
  );
  const matchedSlot = findMatchingSlotForTrainer(requestedStartAt, windows, blockedRanges, timezone);
  const durationMinutes = matchedSlot?.durationMinutes ?? 60;
  const endAt = new Date(requestedStartAt.getTime() + durationMinutes * 60000);

  const { error: bookingError } = await supabase.from("discovery_bookings").insert({
    coach_id: step.trainer_id,
    start_at: requestedStartAt.toISOString(),
    end_at: endAt.toISOString(),
    prospect_name: request.prospect_name,
    prospect_email: request.prospect_email,
    prospect_phone: request.prospect_phone,
    message: request.message,
  });
  if (bookingError) {
    // "that slot was just taken" (double-book guard) shouldn't leave
    // this step silently accepted with no real booking behind it.
    return { ok: false, error: "That slot was just taken — pick a different time." };
  }

  await supabase
    .from("org_trainer_dispatch_steps")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", stepId);
  await supabase
    .from("org_trainer_dispatch_requests")
    .update({ status: "matched", matched_trainer_id: step.trainer_id })
    .eq("id", request.id);

  if (sendEmailConfigured()) {
    await sendEmail(
      request.prospect_email,
      "You're booked!",
      `Hi ${request.prospect_name}, ${trainerProfile?.full_name ?? "your trainer"} confirmed your session request for ${requestedStartAt.toLocaleString()}. See you then!`
    );
  }

  return { ok: true };
}

function sendEmailConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
}

export async function declineDispatchStep(supabase: SupabaseClient, stepId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: step } = await supabase
    .from("org_trainer_dispatch_steps")
    .select("id, status, request_id")
    .eq("id", stepId)
    .single();
  if (!step) return { ok: false, error: "Step not found." };
  if (step.status !== "pending") return { ok: false, error: "This request is no longer open." };

  await supabase
    .from("org_trainer_dispatch_steps")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", stepId);

  await advanceDispatch(supabase, step.request_id);
  return { ok: true };
}

export async function askDispatchQuestion(
  supabase: SupabaseClient,
  stepId: string,
  question: string,
  origin: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: step } = await supabase
    .from("org_trainer_dispatch_steps")
    .select("id, trainer_id, status, request_id")
    .eq("id", stepId)
    .single();
  if (!step) return { ok: false, error: "Step not found." };
  if (step.status !== "pending") return { ok: false, error: "This request is no longer open." };

  const { data: request } = await supabase
    .from("org_trainer_dispatch_requests")
    .select("organization_id, prospect_name, prospect_email")
    .eq("id", step.request_id)
    .single();
  if (!request) return { ok: false, error: "Request not found." };

  const { data: trainerProfile } = await supabase.from("profiles").select("full_name").eq("id", step.trainer_id).single();

  const { data: inserted, error } = await supabase
    .from("org_trainer_dispatch_questions")
    .insert({ step_id: stepId, trainer_id: step.trainer_id, question })
    .select("reply_token")
    .single();
  if (error || !inserted) return { ok: false, error: "Couldn't send the question." };

  if (sendEmailConfigured()) {
    const replyUrl = `${origin}/dispatch-reply/${inserted.reply_token}`;
    await sendEmail(
      request.prospect_email,
      `A question from ${trainerProfile?.full_name ?? "your trainer"}`,
      `${trainerProfile?.full_name ?? "Your trainer"} asked: "${question}"\n\nReply here: ${replyUrl}\n\n(Your original time is still being held while you answer.)`
    );
  }

  await notifyOrgAdmins(
    supabase,
    request.organization_id,
    "trainer_dispatch_question",
    "Trainer asked a question",
    `${trainerProfile?.full_name ?? "A trainer"} asked ${request.prospect_name} a question before accepting.`,
    "/dashboard"
  );

  return { ok: true };
}

export async function answerDispatchQuestion(
  supabase: SupabaseClient,
  replyToken: string,
  answer: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: question } = await supabase
    .from("org_trainer_dispatch_questions")
    .select("id, step_id, trainer_id, answer")
    .eq("reply_token", replyToken)
    .single();
  if (!question) return { ok: false, error: "Question not found." };
  if (question.answer) return { ok: false, error: "This question was already answered." };

  await supabase
    .from("org_trainer_dispatch_questions")
    .update({ answer, answered_at: new Date().toISOString() })
    .eq("id", question.id);

  const { data: step } = await supabase
    .from("org_trainer_dispatch_steps")
    .select("request_id")
    .eq("id", question.step_id)
    .single();
  const { data: request } = step
    ? await supabase
        .from("org_trainer_dispatch_requests")
        .select("organization_id, prospect_name")
        .eq("id", step.request_id)
        .single()
    : { data: null };

  const body = `${request?.prospect_name ?? "The prospect"} answered your question.`;
  await supabase
    .from("notifications")
    .insert({ profile_id: question.trainer_id, group_id: null, type: "trainer_dispatch_question", body, link_path: `/dispatch/${question.step_id}` });
  await sendPushToProfile(supabase, question.trainer_id, "New reply", body, `/dispatch/${question.step_id}`);

  if (request) {
    await notifyOrgAdmins(supabase, request.organization_id, "trainer_dispatch_question", "Prospect replied", body, "/dashboard");
  }

  return { ok: true };
}
