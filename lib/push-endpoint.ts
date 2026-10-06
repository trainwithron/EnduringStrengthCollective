// A push subscription's address is a link the server will call with the person's notifications. Only the real push services are allowed
// (Chrome and Android, Firefox, Windows, Apple), over https, so a made-up address cannot be used to make the server send requests anywhere.
const HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/];

export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== "string" || endpoint.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return HOSTS.some((h) => h.test(url.hostname));
}
