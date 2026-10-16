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

// The address check above only reads the NAME. A name can point at a private address, so right before a call the name is looked up and every address it resolves to must be public. (A name that changes its
// answer between this lookup and the call is not caught by this alone; the call has a short timeout, follows no redirects and shows nobody its answer.)
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (a.includes(":")) {
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(a);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return a === "::" || a === "::1" || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a) || /^ff[0-9a-f]{2}:/.test(a);
  }
  return isPrivateIpv4(a);
}

export type Resolver = (host: string) => Promise<string[]>;

export async function hostResolvesPublic(rawUrl: string, resolve: Resolver): Promise<boolean> {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  try {
    const addresses = await resolve(host);
    return addresses.length > 0 && addresses.every((x) => !isPrivateAddress(x));
  } catch {
    return false;
  }
}
