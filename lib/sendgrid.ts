// Real SendGrid v3 Mail Send API, verified directly against SendGrid's
// own docs (docs.sendgrid.com/api-reference/mail-send/mail-send):
// POST https://api.sendgrid.com/v3/mail/send, Bearer API key, JSON
// body. Shared plumbing per the task's own scope — this app has zero
// email infrastructure today; no specific transactional email is wired
// to this yet (password reset, receipts, etc. are real future callers),
// so this file is deliberately just the sender + config check, ready
// for the first real caller rather than forced into one now.
const SENDGRID_API_URL = "https://api.sendgrid.com/v3/mail/send";

export function isSendGridConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
}

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !from) return false;

  try {
    const res = await fetch(SENDGRID_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: "text/plain", value: text }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
