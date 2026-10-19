import type { NextResponse } from "next/server";
import { ACTING_AS_COOKIE, ACTING_AS_SELF_COOKIE } from "@/lib/acting-as";
import { VIEW_OVERRIDE_COOKIE } from "@/lib/pwa";

// Opening "My training": only a COACH needs the act-as setting (a client already sees the client app as themselves), and the phone-style layout is switched on so it also works at a desktop.
// Used by /my-training/open and by /my-space?view=client, which sets the same cookies itself (SPEED, Oct 19: one hop instead of three).
export function setMyTrainingCookies(response: NextResponse, { userId, groupId, role }: { userId: string; groupId: string; role: string }): void {
  if (role !== "coach") return;
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ACTING_AS_COOKIE, JSON.stringify({ athleteId: userId, groupId }), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 12 });
  response.cookies.set(ACTING_AS_SELF_COOKIE, "1", { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 12 });
  response.cookies.set(VIEW_OVERRIDE_COOKIE, "mobile", { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 12 });
}
