// Where /my-space?view=client sends the coach (app/my-space/route.ts): their own app's Home, or one of its tabs when the phone bar asked for it (&to=calendar|feed|nutrition|settings).
// Only these tabs; anything else opens Home. The month (YYYY-MM) and the Spotlight flag (spot=1) are the only things passed on.
export const MY_SPACE_TABS = ["calendar", "feed", "nutrition", "settings"] as const;
export type MySpaceTab = (typeof MY_SPACE_TABS)[number];

export function mySpaceTarget(spaceId: string, params: URLSearchParams): string {
  const to = params.get("to");
  const tab = (MY_SPACE_TABS as readonly string[]).includes(to ?? "") ? `/${to}` : "";
  const next = new URLSearchParams();
  const month = params.get("month");
  if (month && /^\d{4}-\d{2}$/.test(month)) next.set("month", month);
  if (params.get("spot") === "1") next.set("spot", "1");
  const q = next.toString();
  return `/groups/${spaceId}${tab}${q ? `?${q}` : ""}`;
}

/** The phone bar's link to a tab of the coach's own app, from any page. */
export function mySpaceHref(tab: MySpaceTab | null, extra: { month?: string; spot?: boolean } = {}): string {
  const q = new URLSearchParams({ view: "client" });
  if (tab) q.set("to", tab);
  if (extra.month) q.set("month", extra.month);
  if (extra.spot) q.set("spot", "1");
  return `/my-space?${q.toString()}`;
}
