import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitAllows } from "@/lib/rate-limit";
import { SCAN_COOKIE, SCAN_DEDUPE_MINUTES, countScan, parseScanTarget } from "@/lib/scan-count";

// One scan of a machine's or an exercise's QR page (Ron, Nov 20: M2), told by the page itself once it has opened in a browser. Anonymous: the row is the code and the time, nothing
// about who (no account, no address, no device), written with the server's key (only the server writes qr_scans, step 215). The same browser opening the same code again within 30
// minutes counts once (one small cookie of the codes seen). A code that does not exist is not counted, and one code is counted at most 300 times an hour.
// The body is { machineId } or { exerciseId }.
export async function POST(request: Request) {
  const target = parseScanTarget(await request.json().catch(() => null));
  if (!target) return NextResponse.json({ counted: false }, { status: 400 });

  const jar = await cookies();
  const { counts, cookie } = countScan(jar.get(SCAN_COOKIE)?.value, target, Date.now());
  const answer = (counted: boolean) => {
    const res = NextResponse.json({ counted });
    res.cookies.set(SCAN_COOKIE, cookie, { maxAge: SCAN_DEDUPE_MINUTES * 60, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    return res;
  };
  if (!counts) return answer(false);
  if (!(await rateLimitAllows(`scan-count:${target.id}`, 300, 3600))) return answer(false);

  const db = createServiceRoleClient();
  const table = target.kind === "machine" ? "gym_machines" : "exercise_library";
  const { data: exists } = await db.from(table).select("id").eq("id", target.id).maybeSingle();
  if (!exists) return answer(false);
  // Before step 215 there is no table: nothing is counted, and the page is unaffected.
  const { error } = await db.from("qr_scans").insert(target.kind === "machine" ? { machine_id: target.id } : { exercise_id: target.id });
  return answer(!error);
}
