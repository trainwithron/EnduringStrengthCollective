// Scan counts for printed QR codes (Ron, Nov 20: M2). Each time a machine's (or an exercise's) QR page is opened by a scan, one row is written: which code and when, nothing about
// who (no account, no address, no device). The same browser opening the same code again within 30 minutes counts once, remembered in one small cookie that holds only the codes seen
// and when. Pure, so it is tested; the route is app/api/public/scan and the table is migration 0459 (step 215).
export const SCAN_COOKIE = "spot_scans";
export const SCAN_DEDUPE_MINUTES = 30;
const MAX_REMEMBERED = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ScanTarget = { kind: "machine" | "exercise"; id: string };

export function parseScanTarget(body: unknown): ScanTarget | null {
  const b = (body && typeof body === "object" ? body : {}) as { machineId?: unknown; exerciseId?: unknown };
  if (typeof b.machineId === "string" && UUID.test(b.machineId) && b.exerciseId == null) return { kind: "machine", id: b.machineId.toLowerCase() };
  if (typeof b.exerciseId === "string" && UUID.test(b.exerciseId) && b.machineId == null) return { kind: "exercise", id: b.exerciseId.toLowerCase() };
  return null;
}

const keyOf = (t: ScanTarget) => `${t.kind === "machine" ? "m" : "e"}${t.id}`;

// The codes this browser opened in the last 30 minutes, from the cookie ("m<id>.<minutes since 1970>|..."). Anything unreadable is dropped.
export function readSeen(cookie: string | undefined | null, nowMs: number): Map<string, number> {
  const seen = new Map<string, number>();
  for (const part of (cookie ?? "").split("|")) {
    const m = /^([me][0-9a-f-]{36})\.(\d{1,10})$/.exec(part);
    if (!m) continue;
    const at = Number(m[2]) * 60_000;
    if (nowMs - at < SCAN_DEDUPE_MINUTES * 60_000 && at <= nowMs + 60_000) seen.set(m[1], at);
  }
  return seen;
}

// Whether this opening counts, and the cookie to write back.
export function countScan(cookie: string | undefined | null, target: ScanTarget, nowMs: number): { counts: boolean; cookie: string } {
  const seen = readSeen(cookie, nowMs);
  const key = keyOf(target);
  const counts = !seen.has(key);
  if (counts) seen.set(key, nowMs);
  const kept = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_REMEMBERED);
  return { counts, cookie: kept.map(([k, at]) => `${k}.${Math.floor(at / 60_000)}`).join("|") };
}

// "12 scans this month · 140 all time"
export function scanCountLine(month: number, total: number): string {
  return `${month} ${month === 1 ? "scan" : "scans"} this month · ${total} all time`;
}
