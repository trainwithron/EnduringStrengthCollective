import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import { AiRateLimitedError, aiInputTooLong } from "@/lib/ai-usage";
import { NOTES_SYSTEM, mergeFromAi, normalizeBullets, notesUserText, pushRaw } from "@/lib/client-notes";
import { loadClientNotes, saveClientNotes } from "@/lib/client-notes-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Past AI build notes for one client. LEARN: after the coach has built or corrected with a client chosen, one small AI call turns what they said into a short list of the important facts and merges it
// into the client's list (nothing is written when nothing important was said); the coach's raw words are kept for 30 days for their own view. SAVE: the coach edits or deletes bullets by hand. Private to the
// coach (row policies), the client never reads it, and it is deleted with the client. It can only describe the client: safety, injury and youth rules always stay on top.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const groupId = typeof body.groupId === "string" && UUID.test(body.groupId) ? body.groupId : null;
  const athleteId = typeof body.athleteId === "string" && UUID.test(body.athleteId) ? body.athleteId : null;
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing client." }, { status: 400 });

  const [{ data: coachSeat }, { data: clientSeat }] = await Promise.all([
    supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle(),
    supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle(),
  ]);
  if (coachSeat?.role !== "coach" || !clientSeat) return NextResponse.json({ error: "That client isn't yours." }, { status: 403 });

  const today = new Date().toISOString().slice(0, 10);
  const { bullets, raw } = await loadClientNotes(supabase, user.id, athleteId);

  if (action === "save") {
    const next = normalizeBullets(Array.isArray(body.bullets) ? body.bullets.slice(0, 20) : [], bullets, today);
    const ok = await saveClientNotes(supabase, { coachId: user.id, athleteId, groupId, bullets: next, raw });
    return ok ? NextResponse.json({ ok: true, bullets: next }) : NextResponse.json({ error: "That didn't save. Nothing was changed." }, { status: 500 });
  }

  if (action === "learn") {
    const text = typeof body.text === "string" ? body.text.slice(0, 600) : "";
    const corrections: string[] = Array.isArray(body.corrections) ? body.corrections.filter((c: unknown): c is string => typeof c === "string").map((c: string) => c.slice(0, 300)).slice(0, 6) : [];
    const said = [text, ...corrections].join(" ").trim();
    // Too short to hold anything important, or no AI: nothing to do (and nothing is lost).
    if (said.length < 12 || !isAiConfigured()) return NextResponse.json({ ok: true, changed: false });
    if (aiInputTooLong("client_notes_summary", said)) return NextResponse.json({ ok: true, changed: false });
    let next = bullets;
    let changed = false;
    try {
      const answer = await callClaude({ meta: { feature: "client_notes_summary", userId: user.id }, system: NOTES_SYSTEM, userText: notesUserText(bullets, text, corrections), maxTokens: 500, timeoutMs: 20_000 });
      const merged = mergeFromAi(JSON.parse(extractJson(answer)), bullets, today);
      if (merged) {
        next = merged;
        changed = true;
      }
    } catch (e) {
      // A failed or limited summary never blocks the build: the words are still kept below for 30 days.
      if (!(e instanceof AiRateLimitedError || e instanceof AiNotConfiguredError)) {
        // fall through
      }
    }
    // The raw words are kept (30 days) even when no bullet came out of them.
    const keptRaw = pushRaw(raw, said, new Date());
    await saveClientNotes(supabase, { coachId: user.id, athleteId, groupId, bullets: next, raw: keptRaw });
    return NextResponse.json({ ok: true, changed });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
