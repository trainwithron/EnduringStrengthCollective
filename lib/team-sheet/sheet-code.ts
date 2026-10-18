// The code on every rack sheet (a QR on the paper, a hidden sheet in the Excel file): which group, which days, which exercise is in which column, and which athletes are on this rack. When the filled sheet
// comes back, this is what says what each box means, even if the roster or the program changed since it was printed. One code per rack keeps it small enough for a QR. It is checked, not secret: it holds ids
// only (no names), and a changed one fails its check. Whoever uploads must still be a coach of the group; the code grants nothing.
import { createHash } from "node:crypto";
import type { SheetUnit } from "@/lib/team-sheet/cell-parser";

export interface SheetCode {
  v: 1;
  groupId: string;
  mode: "day" | "week";
  unit: SheetUnit;
  rack: number;
  /** the days on this sheet, in order, each with the exercise ids in column order */
  days: { date: string; exercises: string[] }[];
  /** the athlete ids on this rack, in row order */
  athletes: string[];
}

const compact = (uuid: string) => uuid.replace(/-/g, "");
const expand = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checksum = (body: string) => createHash("sha256").update(body).digest("hex").slice(0, 8);

export function encodeSheetCode(code: SheetCode): string {
  const body = JSON.stringify({
    v: 1,
    g: compact(code.groupId),
    m: code.mode === "week" ? "w" : "d",
    u: code.unit === "kg" ? "k" : "l",
    k: code.rack,
    d: code.days.map((d) => [d.date, d.exercises.map(compact)]),
    a: code.athletes.map(compact),
  });
  const b64 = Buffer.from(body, "utf8").toString("base64url");
  return `TS1.${b64}.${checksum(b64)}`;
}

export type DecodeResult = { ok: true; code: SheetCode } | { ok: false; reason: string };

const DAY_MS = 86_400_000;
/** a real calendar day (2026-02-31 is not one), no more than a day ahead and no more than two years back */
export function isSheetDay(day: string, now: Date = new Date()): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) return false;
  return d.getTime() <= now.getTime() + 2 * DAY_MS && d.getTime() >= now.getTime() - 731 * DAY_MS;
}

export function decodeSheetCode(text: unknown, now: Date = new Date()): DecodeResult {
  const s = typeof text === "string" ? text.trim() : "";
  const m = /^TS1\.([A-Za-z0-9_-]+)\.([0-9a-f]{8})$/.exec(s);
  if (!m) return { ok: false, reason: "That is not a team sheet code." };
  if (checksum(m[1]) !== m[2]) return { ok: false, reason: "The sheet code is damaged." };
  try {
    const j = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    const hex = (x: unknown) => typeof x === "string" && /^[0-9a-f]{32}$/i.test(x);
    if (j?.v !== 1 || !hex(j.g) || (j.m !== "d" && j.m !== "w") || (j.u !== "l" && j.u !== "k") || !Number.isInteger(j.k) || j.k < 1) return { ok: false, reason: "The sheet code is not one this version reads." };
    if (!Array.isArray(j.d) || j.d.length === 0 || j.d.length > 7 || !Array.isArray(j.a) || j.a.length === 0 || j.a.length > 12) return { ok: false, reason: "The sheet code is not one this version reads." };
    const days = (j.d as unknown[]).map((d) => {
      const arr = d as [unknown, unknown];
      if (!Array.isArray(arr) || typeof arr[0] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(arr[0]) || !Array.isArray(arr[1]) || arr[1].length > 40 || !(arr[1] as unknown[]).every(hex)) throw new Error("day");
      if (!isSheetDay(arr[0], now)) throw new Error("date");
      return { date: arr[0], exercises: (arr[1] as string[]).map((h) => expand(h.toLowerCase())) };
    });
    if (!(j.a as unknown[]).every(hex)) return { ok: false, reason: "The sheet code is not one this version reads." };
    const code: SheetCode = { v: 1, groupId: expand(j.g.toLowerCase()), mode: j.m === "w" ? "week" : "day", unit: j.u === "k" ? "kg" : "lb", rack: j.k, days, athletes: (j.a as string[]).map((h) => expand(h.toLowerCase())) };
    if (![code.groupId, ...code.athletes, ...code.days.flatMap((d) => d.exercises)].every((u) => UUID.test(u))) return { ok: false, reason: "The sheet code is not one this version reads." };
    return { ok: true, code };
  } catch (e) {
    if (e instanceof Error && e.message === "date") return { ok: false, reason: "The sheet code has a date that is not a real day in the last two years." };
    return { ok: false, reason: "The sheet code is not one this version reads." };
  }
}
