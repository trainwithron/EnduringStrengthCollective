// Where a coach's automation (Zapier and the like) may be called. The server makes this request itself, so an address that points inside our own network
// (a cloud metadata address, localhost, a private range) must never be allowed. Checked when the address is saved AND again right before every call,
// because a coach can also write the table directly.
export const WEBHOOK_TIMEOUT_MS = 5000;

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function isSafeWebhookUrl(raw: string | null | undefined): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return false; // no bare names like "localhost" or "metadata"
  if (host.startsWith("[") || host.includes(":")) return false; // no IPv6 literals
  if (/^[0-9.]+$/.test(host)) return false; // no IP addresses at all, private or not
  if (isPrivateIpv4(host)) return false;
  if (/(^|\.)(localhost|local|internal|localdomain|lan|home|corp|intranet)$/.test(host)) return false;
  return true;
}
