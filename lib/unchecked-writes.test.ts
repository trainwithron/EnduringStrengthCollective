import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { uncheckedWrites } from "@/lib/unchecked-writes-scan";
import baseline from "@/lib/unchecked-writes-baseline.json";

const root = join(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

// A ratchet: screens must not throw away the result of a database write (a failed save looks exactly like a good one). The files below still do, as of this list; the count may only go DOWN. A new file, or more
// of them in a file, fails this test: check the result with checked() (lib/checked-write.ts) and say so on screen when it did not save, then lower the number here.
describe("screens do not throw away the result of a database write", () => {
  const files = walk(join(root, "components"));
  const counts = new Map<string, number>();
  for (const f of files) {
    const n = uncheckedWrites(readFileSync(f, "utf8").replace(/\r\n/g, "\n")).length;
    if (n > 0) counts.set(f.slice(root.length + 1).replace(/\\/g, "/"), n);
  }
  const allowed = baseline as Record<string, number>;

  it("no file has more unchecked writes than the list allows, and no new file has any", () => {
    const over = [...counts].filter(([f, n]) => n > (allowed[f] ?? 0)).map(([f, n]) => `${f}: ${n} (allowed ${allowed[f] ?? 0})`);
    expect(over, "check the result of the write (checked() in lib/checked-write.ts) instead of ignoring it").toEqual([]);
  });
  it("the list only shrinks: a file that was fixed is taken off it", () => {
    const stale = Object.keys(allowed).filter((f) => !counts.has(f) || (counts.get(f) ?? 0) < allowed[f]);
    expect(stale, "lower or remove these numbers in lib/unchecked-writes-baseline.json").toEqual([]);
  });
  it("the scanner finds a thrown-away write and leaves a checked one alone", () => {
    expect(uncheckedWrites('async function f(){\n  await supabase.from("x").update({ a: 1 }).eq("id", 1);\n}')).toHaveLength(1);
    expect(uncheckedWrites('async function f(){\n  await supabase\n    .from("x")\n    .delete()\n    .eq("id", 1);\n}')).toHaveLength(1);
    expect(uncheckedWrites('async function f(){\n  const r = await supabase.from("x").update({ a: 1 }).eq("id", 1);\n}')).toHaveLength(0);
    expect(uncheckedWrites('async function f(){\n  await supabase.from("x").select("id");\n}')).toHaveLength(0);
  });
});
