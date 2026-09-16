// Twilio requires E.164 (+<countrycode><number>, digits only after the
// +) — https://www.twilio.com/docs/glossary/what-e164. Every phone
// field in this app so far (athlete_profile_details.phone, emergency
// contact numbers) is free-text, typed by hand, so anything that sends
// an SMS needs to normalize first rather than assume the stored string
// is already dial-able. US/Canada-biased on purpose (this app's real
// current userbase) but accepts an already-international "+"-prefixed
// number unchanged.
export function normalizePhoneToE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
