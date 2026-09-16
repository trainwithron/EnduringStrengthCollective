// Real Twilio Programmable Messaging REST API, verified directly
// against Twilio's own docs (twilio.com/docs/sms/send-messages):
// POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
// Basic-auth'd with AccountSid:AuthToken, form-urlencoded body. No SDK
// dependency needed for a plain outbound send — one fetch call, same
// "raw REST over the official npm package" choice already made for
// SendGrid (lib/sendgrid.ts) and consistent with this app's existing
// Garmin/Google Health integrations.
//
// Self-serve, no OAuth/partner-approval gate (unlike Garmin) — the one
// real prerequisite beyond these three env vars is Twilio's own 10DLC
// business/campaign registration for US A2P messaging, a carrier
// requirement with its own ~1-2 business day lead time, separate from
// anything this code can do. Not configured here means every send
// silently no-ops rather than failing loudly, same degrade convention
// as every other provider in this app.
const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
  );
}

export async function sendSms(toE164: string, body: string): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) return false;

  const params = new URLSearchParams({ To: toE164, From: from, Body: body });
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  try {
    const res = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
