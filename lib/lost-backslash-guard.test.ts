import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// A backslash is easy to lose when source is written through a shell (a heredoc or echo): /\s+/ becomes /s+/ and quietly splits a name at the letter s, or /[^\s@]+@/ refuses every email with an s in it.
// Twice this cost real users. This test reads every source file and fails on the shapes a lost backslash leaves behind. If a hit is genuine text (not a pattern), reword it or add the exact line to ALLOWED.
const ROOT = join(__dirname, "..");
const DIRS = ["app", "components", "lib", "scripts", "middleware.ts"];
const SELF = "lib/lost-backslash-guard.test.ts";

const SHAPES: { name: string; re: RegExp }[] = [
  { name: "[^s@] or [^s] (a character class that lost its \\s)", re: /\[\^s[@\]]/ },
  { name: "(d+) or (d{n}) (a capture that lost its \\d)", re: /\(d[+*{]/ },
  { name: "(w+) (a capture that lost its \\w)", re: /\(w[+*]\)/ },
  { name: ")s* or )s+ (a space run that lost its \\s)", re: /\)s[*+]/ },
  { name: "/s+/ or /s*/ as a whole pattern (lost \\s)", re: /\/s[*+]\// },
  { name: "/^d+$/ (lost \\d)", re: /\^d[+*{]/ },
  { name: "|s+$ or ^s+| (trim pattern that lost \\s)", re: /\|s\+\$|\^s\+\|/ },
  { name: "]+.[ (an unescaped dot between two classes, as in an email pattern)", re: /\]\+\.\[/ },
];

// Lines that are text on purpose and contain one of the shapes. Empty today.
const ALLOWED: string[] = [];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
}

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const d of DIRS) {
    const full = join(ROOT, d);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("no source file has a pattern that lost its backslash", () => {
  it("reads every regex shape that a lost backslash leaves behind", () => {
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (rel === SELF) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const shape of SHAPES) {
          if (shape.re.test(line) && !ALLOWED.includes(`${rel}:${line.trim()}`)) hits.push(`${rel}:${i + 1}  ${shape.name}  ::  ${line.trim().slice(0, 140)}`);
        }
      });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the guard itself can see the shapes it looks for", () => {
    // Built from pieces so this file does not contain a shape itself.
    const bad = ["const a = x.split(/", "s+", "/);", "if (!/^[^", "s@]+@[^", "s@]+", ".", "[^", "s@]{2,}$/.test(e)) {}"];
    const line = bad.join("");
    expect(SHAPES.filter((s) => s.re.test(line)).length).toBeGreaterThanOrEqual(2);
    expect(SHAPES.some((s) => s.re.test("const ok = x.split(/\\s+/);"))).toBe(false);
  });
});
