import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { answerDispatchQuestion } from "@/lib/trainer-dispatch-advance";
import { rateLimitResponse, clientIp } from "@/lib/rate-limit";

// Public — the prospect answering a trainer's question has no account
// at all, same as the rest of this feature's prospect-facing surface.
// The reply_token itself (a real UUID, unguessable) is the only "auth"
// here, same shape as guardian_links' own tokenized public access.
export async function POST(request: Request) {
  const limited = await rateLimitResponse("dispatch-reply", clientIp(request), 30, 3600);
  if (limited) return limited;

  const { replyToken, answer } = await request.json().catch(() => ({}));
  if ((typeof replyToken === "string" && replyToken.length > 100) || (typeof answer === "string" && answer.length > 2000)) {
    return NextResponse.json({ error: "That answer is too long." }, { status: 400 });
  }
  if (!replyToken || !answer || typeof answer !== "string" || !answer.trim()) {
    return NextResponse.json({ error: "An answer is required." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const result = await answerDispatchQuestion(supabase, replyToken, answer.trim());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
