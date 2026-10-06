import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_FACING_PATHS, CLIENT_FACING_RULES, PRODUCT_WIDE_EXEMPT_FILES, PRODUCT_WIDE_RULES, VOCABULARY_EXCEPTIONS } from "./vocabulary";

const root = join(__dirname, "..");

function filesUnder(rel: string): string[] {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = join(rel, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(child));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(child);
  }
  return out;
}

// The text a person can read in a source file: string literals and JSX text, with comments removed.
export function visibleText(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const m of noComments.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g)) out.push(m[2].replace(/\s+/g, " ").trim());
  for (const m of noComments.matchAll(/[>}]([^<>{}]+)[<{]/g)) out.push(m[1].replace(/\s+/g, " ").trim());
  return out.filter((t) => t.length > 0);
}

describe("visibleText", () => {
  it("finds strings and JSX text but not comments", () => {
    const src = `// a session credit comment\nconst a = "Uses 1 session";\nreturn <p>Your {x} sessions left</p>; /* credit */`;
    expect(visibleText(src)).toEqual(["Uses 1 session", "Your", "sessions left"]);
  });
});

describe("one vocabulary: what clients and visitors read", () => {
  const files = [...new Set(CLIENT_FACING_PATHS.flatMap(filesUnder))];

  it("covers real files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const rule of CLIENT_FACING_RULES) {
    it(`says ${rule.use}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        for (const text of visibleText(readFileSync(join(root, file), "utf8"))) {
          if (VOCABULARY_EXCEPTIONS.some((e) => e.text === text)) continue;
          if (rule.avoid.some((re) => re.test(text))) offenders.push(`${file.replace(/\\/g, "/")}: "${text.slice(0, 100)}"`);
        }
      }
      expect(offenders, rule.why).toEqual([]);
    });
  }
});

describe("one vocabulary: the whole product", () => {
  const allFiles = ["app", "components", "lib"].flatMap(filesUnder);
  const codeish = (t: string) => /^[@./]/.test(t) || /\bimport\b|from "|trainer-dispatch|trainer_|org-trainer/.test(t);

  it("covers the whole app", () => {
    expect(allFiles.length).toBeGreaterThan(500);
  });

  for (const rule of PRODUCT_WIDE_RULES) {
    it(`says ${rule.use}`, () => {
      const offenders: string[] = [];
      for (const file of allFiles) {
        const rel = file.split(String.fromCharCode(92)).join("/");
        if (PRODUCT_WIDE_EXEMPT_FILES.some((e) => e.file === rel)) continue;
        for (const text of visibleText(readFileSync(join(root, file), "utf8"))) {
          if (codeish(text)) continue;
          if (rule.avoid.some((re) => re.test(text))) offenders.push(`${rel}: "${text.slice(0, 100)}"`);
        }
      }
      expect(offenders, rule.why).toEqual([]);
    });
  }
});
