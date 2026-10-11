// Outgoing email through Brevo's transactional email API (POST https://api.brevo.com/v3/smtp/email, `api-key` header, JSON body). Plain text only: every email this app sends is
// transactional (sign-in links, booking and credit notices, a coach's own message, a cron failure alert). No marketing or sales email is ever sent. The free Brevo plan may add
// its own small footer; that is Brevo's and is not removed.
//
// Fails closed: with no key or no sender address set, nothing is sent and the caller is told so (false), exactly as before.
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_SENDER_NAME = "Spotlight Coaching";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL);
}

// One line for the server log when Brevo refuses a send: the HTTP status and Brevo's own error code and message (for example "401 unauthorized: Key not found", "400
// invalid_parameter: sender not valid"). It never contains the API key, the recipient or the message text, and it is cut short so a surprising response cannot flood the log.
export async function describeBrevoFailure(res: { status: number; text(): Promise<string> }): Promise<string> {
  let code = "";
  let message = "";
  try {
    const raw = await res.text();
    try {
      const parsed = JSON.parse(raw) as { code?: unknown; message?: unknown };
      if (typeof parsed.code === "string") code = parsed.code;
      if (typeof parsed.message === "string") message = parsed.message;
    } catch {
      message = raw;
    }
  } catch {
    // no readable body: the status alone is still useful
  }
  // Brevo's own text can echo a value it rejected (a recipient address), so anything that looks like an email address is blanked out, and so is the key if it ever appears.
  const apiKey = process.env.BREVO_API_KEY;
  let line = `[email] Brevo refused the send: HTTP ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`;
  if (apiKey) line = line.split(apiKey).join("[key]");
  line = line.replace(/[^\s@"'<>]+@[^\s@"'<>]+/g, "[email]");
  return line.slice(0, 300);
}

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_FROM_EMAIL;
  if (!apiKey || !from) return false;

  try {
    const res = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_FROM_NAME || DEFAULT_SENDER_NAME, email: from },
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
    });
    if (!res.ok) {
      console.error(await describeBrevoFailure(res));
      return false;
    }
    return true;
  } catch (e) {
    // Only the kind of failure (never the request, which holds the recipient and the key).
    console.error(`[email] Brevo request failed: ${e instanceof Error ? e.name : "error"}`);
    return false;
  }
}
