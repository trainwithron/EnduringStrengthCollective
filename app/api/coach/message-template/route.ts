import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_CLAIM_TEMPLATE, validateTemplate } from "@/lib/message-template";

// A coach's own wording for the sign-in link email. Their own row only (row security enforces it); validated here too (plain text, length caps, {link} required).
// GET gives the coach's version (or the default), PUT saves theirs, DELETE goes back to the default.
async function whoAmI() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await whoAmI();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data } = await supabase.from("coach_message_templates").select("claim_email_subject, claim_email_body").eq("coach_id", user.id).maybeSingle();
  if (data) {
    const checked = validateTemplate({ subject: data.claim_email_subject, body: data.claim_email_body });
    if (checked.ok) return NextResponse.json({ ...checked.template, isDefault: false, defaults: DEFAULT_CLAIM_TEMPLATE });
  }
  return NextResponse.json({ ...DEFAULT_CLAIM_TEMPLATE, isDefault: true, defaults: DEFAULT_CLAIM_TEMPLATE });
}

export async function PUT(request: Request) {
  const { supabase, user } = await whoAmI();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const checked = validateTemplate({ subject: body.subject, body: body.body });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { error } = await supabase.from("coach_message_templates").upsert(
    { coach_id: user.id, claim_email_subject: checked.template.subject, claim_email_body: checked.template.body, updated_at: new Date().toISOString() },
    { onConflict: "coach_id" }
  );
  if (error) return NextResponse.json({ error: "Couldn't save your message. Try again in a moment." }, { status: 500 });
  return NextResponse.json({ ok: true, ...checked.template });
}

export async function DELETE() {
  const { supabase, user } = await whoAmI();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { error } = await supabase.from("coach_message_templates").delete().eq("coach_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't go back to the default. Try again in a moment." }, { status: 500 });
  return NextResponse.json({ ok: true, ...DEFAULT_CLAIM_TEMPLATE });
}
