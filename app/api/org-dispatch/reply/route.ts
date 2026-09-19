import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { answerDispatchQuestion } from "@/lib/trainer-dispatch-advance";

// Public — the prospect answering a trainer's question has no account
// at all, same as the rest of this feature's prospect-facing surface.
// The reply_token itself (a real UUID, unguessable) is the only "auth"
// here, same shape as guardian_links' own tokenized public access.
export async function POST(request: Request) {
  const { replyToken, answer } = await request.json();
  if (!replyToken || !answer || typeof answer !== "string" || !answer.trim()) {
    return NextResponse.json({ error: "An answer is required." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const result = await answerDispatchQuestion(supabase, replyToken, answer.trim());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
