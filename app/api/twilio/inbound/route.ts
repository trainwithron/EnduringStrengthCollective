import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizePhoneToE164 } from "@/lib/phone";
import {
  classifySmsKeyword,
  SMS_HELP_REPLY,
  twimlResponse,
  verifyTwilioSignature,
} from "@/lib/twilio-inbound";

// Twilio posts every text a client sends back to our number here. We only
// act on the standard opt-out / opt-in / help keywords, recording them
// against the consent row for that phone number (STOP stops ALL client
// texts to that number; START resumes whatever they had chosen).
//
// Authentication is Twilio's request signature (X-Twilio-Signature), never
// a session: an unsigned or tampered request is rejected before anything is
// read or written. The signature covers the exact public URL Twilio was
// configured with, so set TWILIO_INBOUND_WEBHOOK_URL to that value (it
// falls back to the request's own forwarded host).
function publicUrl(request: Request): string {
  if (process.env.TWILIO_INBOUND_WEBHOOK_URL) return process.env.TWILIO_INBOUND_WEBHOOK_URL;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${url.pathname}`;
}

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/xml" } });
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return new NextResponse("Not configured", { status: 503 });

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  if (!verifyTwilioSignature(publicUrl(request), params, authToken, request.headers.get("x-twilio-signature"))) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const phone = normalizePhoneToE164(params.From ?? "");
  if (!phone) return xml(twimlResponse());

  const keyword = classifySmsKeyword(params.Body);
  if (keyword === "other") return xml(twimlResponse());

  const supabase = createServiceRoleClient();

  if (keyword === "stop") {
    const { error } = await supabase.rpc("record_sms_stop", { p_phone: phone });
    if (error) return new NextResponse("Error", { status: 500 }); // Twilio retries
    return xml(twimlResponse());
  }

  if (keyword === "start") {
    const { error } = await supabase.rpc("record_sms_start", { p_phone: phone });
    if (error) return new NextResponse("Error", { status: 500 });
    return xml(twimlResponse());
  }

  const { error } = await supabase.rpc("record_sms_help", { p_phone: phone });
  if (error) return new NextResponse("Error", { status: 500 });
  return xml(twimlResponse(SMS_HELP_REPLY));
}
