import { isValidTimeZone } from "@/lib/format-in-timezone";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

// A coach who travels (Las Vegas, then Alabama) keeps ONE business zone, profiles.timezone: their open hours, time off and every booked session
// are anchored to it, so a client never sees an hour move. What follows the device they are holding is only how the coach READS times: this
// cookie carries the device's zone to the server, so server-rendered pages show the coach the same real moments on the coach's own clock.
export const DEVICE_TZ_COOKIE = "device_tz";

// The zone a person is shown times in: their device's zone when it is known and valid, otherwise their saved zone, otherwise the app default.
export function resolveDisplayZone(deviceZone: string | null | undefined, businessZone: string | null | undefined): string {
  if (isValidTimeZone(deviceZone)) return deviceZone;
  if (isValidTimeZone(businessZone)) return businessZone;
  return DEFAULT_COACH_TIMEZONE;
}

// The value of the device-zone cookie out of a cookie header / document.cookie string (the value is URL-encoded because zone names hold a slash).
export function readDeviceZoneCookie(cookieString: string | null | undefined): string | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === DEVICE_TZ_COOKIE) {
      try {
        const value = decodeURIComponent(rest.join("="));
        return isValidTimeZone(value) ? value : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// "Central time", "Pacific time": the plain name of a zone at a given moment, without the daylight / standard word, for the one-line note.
export function zoneLabel(timeZone: string, now: Date = new Date()): string {
  if (timeZone === "UTC") return "UTC";
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "long" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  if (!name || !/ Time$/.test(name)) return name ?? timeZone;
  return name.replace(/ (Standard|Daylight|Summer) /i, " ").replace(/ Time$/, " time");
}
