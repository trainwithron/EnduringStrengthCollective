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
    return res.ok;
  } catch {
    return false;
  }
}
