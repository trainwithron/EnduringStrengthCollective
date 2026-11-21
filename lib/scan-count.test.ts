import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCAN_COOKIE, countScan, parseScanTarget, readSeen, scanCountLine } from "@/lib/scan-count";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const M = "11111111-1111-4111-8111-111111111111";
const E = "22222222-2222-4222-8222-222222222222";
const T0 = Date.UTC(2026, 10, 20, 15, 0, 0);
const min = (n: number) => n * 60_000;

describe("scan counts for machine QR codes (Ron, Nov 20: M2)", () => {
  it("takes one code: a machine or an exercise, by id", () => {
    expect(parseScanTarget({ machineId: M })).toEqual({ kind: "machine", id: M });
    expect(parseScanTarget({ exerciseId: E.toUpperCase() })).toEqual({ kind: "exercise", id: E });
    expect(parseScanTarget({ machineId: M, exerciseId: E })).toBeNull();
    expect(parseScanTarget({ machineId: "x" })).toBeNull();
    expect(parseScanTarget(null)).toBeNull();
  });
  it("the same browser and code within 30 minutes counts once; after that, again", () => {
    const first = countScan(undefined, { kind: "machine", id: M }, T0);
    expect(first.counts).toBe(true);
    expect(countScan(first.cookie, { kind: "machine", id: M }, T0 + min(29)).counts).toBe(false);
    expect(countScan(first.cookie, { kind: "machine", id: M }, T0 + min(31)).counts).toBe(true);
    // another code is its own count
    expect(countScan(first.cookie, { kind: "exercise", id: E }, T0 + min(1)).counts).toBe(true);
  });
  it("the cookie holds only the codes and the minute, keeps 20 at most, and forgets old or broken entries", () => {
    const { cookie } = countScan(undefined, { kind: "machine", id: M }, T0);
    expect(cookie).toBe(`m${M}.${Math.floor(T0 / 60_000)}`);
    let c = "";
    for (let i = 0; i < 25; i++) c = countScan(c, { kind: "machine", id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111` }, T0 + i * 1000).cookie;
    expect(c.split("|").length).toBe(20);
    expect(readSeen(`junk|m${M}.${Math.floor((T0 - min(45)) / 60_000)}`, T0).size).toBe(0);
  });
  it("words the count as the board does", () => {
    expect(scanCountLine(12, 140)).toBe("12 scans this month · 140 all time");
    expect(scanCountLine(1, 1)).toBe("1 scan this month · 1 all time");
  });
  it("is counted on the server with nothing about who: no account, no address, no device", () => {
    const route = read("app/api/public/scan/route.ts");
    expect(route).toContain("createServiceRoleClient()");
    expect(route).toContain('.from("qr_scans").insert(target.kind === "machine" ? { machine_id: target.id } : { exercise_id: target.id })');
    expect(route).not.toMatch(/clientIp|x-forwarded-for|user-agent|auth\.getUser/i);
    expect(route).toContain(`httpOnly: true`);
    expect(SCAN_COOKIE).toBe("spot_scans");
    const sql = read("supabase/migrations/0459_weekly_checkins_goal_review_scan_counts.sql");
    const table = sql.slice(sql.indexOf("create table if not exists public.qr_scans"), sql.indexOf("create index if not exists qr_scans_machine_idx"));
    expect(table).not.toMatch(/profile|user|ip|agent|device/i);
  });
  it("both scan pages count, an exercise opened from a machine's list does not, and the coach sees the counts where machines are managed", () => {
    expect(read("app/scan/machine/[machineId]/page.tsx")).toContain("<ScanCounter machineId={machine.id} />");
    expect(read("app/scan/[exerciseId]/page.tsx")).toContain("{!fromMachine && <ScanCounter exerciseId={exercise.id} />}");
    expect(read("components/public/scan-counter.tsx")).toContain('startsWith("/scan/machine/")');
    expect(read("components/coach/gym-machines-panel.tsx")).toContain("scanCountLine(scanCounts[m.id]?.month ?? 0, scanCounts[m.id]?.total ?? 0)");
    expect(read("app/(coach)/groups/[groupId]/exercise-library/page.tsx")).toContain('supabase.rpc("count_machine_scans", { p_since: monthBoundsInZone(tz).startIso })');
  });
});
