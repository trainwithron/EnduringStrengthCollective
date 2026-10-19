export const LAST_WORKSPACE_GROUP_COOKIE = "last_workspace_group";

// Defense in depth for the organization walls (migrations 0348 and 0349): every data request names the workspace it is for, as the request header x-workspace-group (the group id of the open
// workspace). The database then refuses a row of any other organization on the tables whose rows belong to a group, even to a coach who is a coach in two organizations. No header, or a header
// that is not a group id, changes nothing. The few flows that deliberately work across two organizations (copying a program into another organization) use a client built with { crossOrg: true },
// which sends no header.
export const WORKSPACE_HEADER = "x-workspace-group";
// FIX 4 (one organization value everywhere, migration 0425): the organization the person CHOSE (the active_org cookie, lib/active-org.ts) is sent too, off a group page, and the database follows it when the
// person belongs to it. On a group page only the page's group is sent (as before): that page is in the chosen organization, or the person confirmed switching to it.
export const WORKSPACE_ORG_HEADER = "x-workspace-org";
export const ACTIVE_ORG_COOKIE_NAME = "active_org";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asWorkspaceGroupId(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

export function decodeWorkspaceCookie(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return asWorkspaceGroupId(decodeURIComponent(raw));
  } catch {
    return asWorkspaceGroupId(raw);
  }
}

// The group a group page is on: /groups/<id>/...
export function groupIdFromPath(pathname: string): string | null {
  const m = /^\/groups\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname);
  return m ? asWorkspaceGroupId(m[1]) : null;
}

// In the browser: the group of the page being viewed, else the remembered workspace.
// Pages that open a person's OWN rows from a link or a list spanning their organizations (a session, My training, notifications, a printed program) send no workspace at all.
export const NO_WORKSPACE_PATHS = ["/sessions/", "/my-training", "/my-space", "/notifications", "/print/"];
export function pathSendsNoWorkspace(pathname: string): boolean {
  return NO_WORKSPACE_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

export function workspaceGroupInBrowser(): string | null {
  if (typeof window === "undefined") return null;
  if (pathSendsNoWorkspace(window.location.pathname)) return null;
  const fromPath = groupIdFromPath(window.location.pathname);
  if (fromPath) return fromPath;
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${LAST_WORKSPACE_GROUP_COOKIE}=`))?.split("=")[1];
  return decodeWorkspaceCookie(raw);
}

/** The headers a browser data request carries on this page: the page's group on a group page; elsewhere the remembered group and the chosen organization; nothing on a page that sends no workspace. */
export function workspaceHeadersFor(pathname: string, cookieHeader: string): Record<string, string> {
  if (pathSendsNoWorkspace(pathname)) return {};
  const fromPath = groupIdFromPath(pathname);
  if (fromPath) return { [WORKSPACE_HEADER]: fromPath };
  const read = (name: string) => cookieHeader.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1];
  const out: Record<string, string> = {};
  const group = decodeWorkspaceCookie(read(LAST_WORKSPACE_GROUP_COOKIE));
  if (group) out[WORKSPACE_HEADER] = group;
  const org = decodeWorkspaceCookie(read(ACTIVE_ORG_COOKIE_NAME));
  if (org) out[WORKSPACE_ORG_HEADER] = org;
  return out;
}

// A fetch that adds the headers to database (REST) requests only; sign-in, storage and function calls are left alone.
export const workspaceFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const add = url.includes("/rest/v1/") && typeof window !== "undefined" ? workspaceHeadersFor(window.location.pathname, document.cookie) : {};
  if (Object.keys(add).length === 0) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
  for (const [k, v] of Object.entries(add)) headers.set(k, v);
  return fetch(input, { ...init, headers });
};
