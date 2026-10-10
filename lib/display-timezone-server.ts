import { cache } from "react";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEVICE_TZ_COOKIE, readDeviceZoneCookie, resolveDisplayZone } from "@/lib/display-timezone";

// The zone this signed-in person is shown times in on a server-rendered page: the zone their device reported (see DEVICE_TZ_COOKIE), else their saved
// profile zone. Display only: availability, slots and booked sessions are anchored to the coach's saved zone and never use this.
// Read once per page render: a page and the helpers under it share the answer instead of each asking.
export const getViewerDisplayTimezone = cache(readViewerDisplayTimezone);

async function readViewerDisplayTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  const store = await cookies();
  const device = readDeviceZoneCookie(`${DEVICE_TZ_COOKIE}=${store.get(DEVICE_TZ_COOKIE)?.value ?? ""}`);
  if (device) return device;
  const { data } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return resolveDisplayZone(null, (data?.timezone as string | null | undefined) ?? null);
}
