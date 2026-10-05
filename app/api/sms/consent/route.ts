import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { parseSmsConsentInput, SMS_DISCLOSURE_VERSION } from "@/lib/sms-consent";

// The signed-in person records their OWN text-message consent. The database
// function derives the athlete from the session (auth.uid()), never from the
// request, so nobody can consent on someone else's behalf.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = parseSmsConsentInput(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { error } = await supabase.rpc("set_sms_consent", {
    p_phone: parsed.phoneE164,
    p_appointments: parsed.appointments,
    p_announcements: parsed.announcements,
    p_disclosure_version: SMS_DISCLOSURE_VERSION,
  });
  if (error) {
    // The function's own messages are written for the athlete (e.g. the
    // "you replied STOP" one); anything else stays generic.
    const friendly = /STOP|valid mobile/i.test(error.message) ? error.message : "Couldn't save that — try again.";
    return NextResponse.json({ error: friendly }, { status: 400 });
  }

  return NextResponse.json({ ok: true, phone: parsed.phoneE164 });
}
