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

// Each place in the coach's own app has its own address, /my-space/<place> (app/my-space/[place]/route.ts). They used to differ only after the "?" (/my-space?view=client&to=calendar), and the
// browser's router keeps one remembered answer per address WITHOUT the "?" part: it took the redirect it had remembered for Home (/groups/<space>) for the Calendar link and put Calendar's
// "?view=client&to=calendar" on it, so a soft link to the Calendar landed on Home (Oct 27). A different path for each place is a different address to the router.
export const MY_SPACE_PLACES = ["home", "spotlight", ...MY_SPACE_TABS] as const;
export type MySpacePlace = (typeof MY_SPACE_PLACES)[number];

export function isMySpacePlace(place: string): place is MySpacePlace {
  return (MY_SPACE_PLACES as readonly string[]).includes(place);
}

/** The /my-space?view=client query a place stands for, with the month (and Spotlight) from the address's own query passed on: mySpaceTarget then reads it as before. */
export function placeParams(place: MySpacePlace, search: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams({ view: "client" });
  if ((MY_SPACE_TABS as readonly string[]).includes(place)) q.set("to", place);
  if (place === "spotlight" || search.get("spot") === "1") q.set("spot", "1");
  const month = search.get("month");
  if (month && /^\d{4}-\d{2}$/.test(month)) q.set("month", month);
  return q;
}

/** The phone bar's link to a tab of the coach's own app (Home when no tab), from any page. */
export function mySpaceHref(tab: MySpaceTab | null, extra: { month?: string; spot?: boolean } = {}): string {
  const q = new URLSearchParams();
  if (extra.month && /^\d{4}-\d{2}$/.test(extra.month)) q.set("month", extra.month);
  const place: MySpacePlace = tab ?? (extra.spot ? "spotlight" : "home");
  if (tab && extra.spot) q.set("spot", "1");
  const s = q.toString();
  return `/my-space/${place}${s ? `?${s}` : ""}`;
}
