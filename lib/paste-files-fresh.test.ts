import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The files Ron pastes must be the migrations that were tested, byte for byte: a paste file that is a build behind the migration (the rehearsal runs the migration, not the paste file) would put different SQL in the
// database than the one reviewed. And a notice that links to a page that does not exist is a dead tap: every complete link written in a new migration must lead somewhere.
const ROOT = join(__dirname, "..");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const read = (p: string) => lf(readFileSync(join(ROOT, p), "utf8"));

interface Step {
  n: string;
  slug: string;
  migrations?: string[];
}
const steps = JSON.parse(read("supabase/apply/steps.json")) as Step[];
const bundles = JSON.parse(read("supabase/apply/bundles.json")) as { id: string; steps: string[]; file: string }[];
const migrationFiles = readdirSync(join(ROOT, "supabase/migrations"));
const migrationText = (m: string): string => {
  const file = migrationFiles.find((f) => f.startsWith(`${m}_`));
  if (!file) throw new Error(`no migration file for ${m}`);
  return read(`supabase/migrations/${file}`).trim();
};

describe("the paste files are the migrations that were tested", () => {
  it("every step's paste file contains its migration, byte for byte", () => {
    const stale: string[] = [];
    for (const step of steps) {
      const file = `supabase/apply/apply-step${step.n}-${step.slug}.sql`;
      if (!existsSync(join(ROOT, file))) {
        stale.push(`${file}: missing`);
        continue;
      }
      const text = read(file);
      for (const m of step.migrations ?? []) if (!text.includes(migrationText(m))) stale.push(`${file}: differs from migration ${m}`);
    }
    expect(stale, `paste files behind their migrations (run node scripts/build-paste-files.mjs):\n${stale.join("\n")}`).toEqual([]);
  });

  it("every bundle contains the migrations of the steps it lists, byte for byte", () => {
    const stale: string[] = [];
    for (const bundle of bundles) {
      if (!existsSync(join(ROOT, `supabase/apply/${bundle.file}`))) {
        stale.push(`${bundle.file}: missing`);
        continue;
      }
      const text = read(`supabase/apply/${bundle.file}`);
      for (const n of bundle.steps) {
        const step = steps.find((s) => s.n === n);
        if (!step) {
          stale.push(`${bundle.file}: unknown step ${n}`);
          continue;
        }
        for (const m of step.migrations ?? []) if (!text.includes(migrationText(m))) stale.push(`${bundle.file}: differs from migration ${m}`);
      }
    }
    expect(stale, `bundles behind their migrations (run node scripts/build-paste-files.mjs):\n${stale.join("\n")}`).toEqual([]);
  });
});

// All the pages of the app, with route groups "(coach)" left out and dynamic parts as "[x]".
function routes(dir = "app", prefix = "", out = new Set<string>()): Set<string> {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) {
      const seg = e.name.startsWith("(") ? "" : `/${e.name}`;
      routes(`${dir}/${e.name}`, prefix + seg, out);
    } else if (e.name === "page.tsx") out.add(prefix || "/");
  }
  return out;
}

describe("a notice's link leads somewhere", () => {
  it("every complete link written in a migration from 0405 on is a page of the app (or a page of a group)", () => {
    const all = routes();
    const groupPages = [...all].filter((r) => r.startsWith("/groups/[groupId]/")).map((r) => r.slice("/groups/[groupId]".length));
    const bad: string[] = [];
    for (const file of migrationFiles.filter((f) => /^\d{4}_/.test(f) && Number(f.slice(0, 4)) >= 405 && Number(f.slice(0, 4)) <= 499)) {
      const text = read(`supabase/migrations/${file}`);
      // the quoted paths that are used as a link_path or a link in an insert: '/reports', '/admin/support', '/dashboard', '/' ...
      for (const m of text.matchAll(/'(\/[a-z][a-z0-9\-/]*|\/)'/g)) {
        const path = m[1];
        if (path === "/") continue;
        const full = all.has(path);
        // a piece that continues a group link ('/groups/' || id || '/business/support') is a page under a group
        const underGroup = groupPages.includes(path);
        // the prefixes of a link built from parts end in a slash or name the groups root
        const isPrefix = path === "/groups" || path.endsWith("/");
        if (!full && !underGroup && !isPrefix) bad.push(`${file}: ${path}`);
      }
    }
    expect(bad, `links to pages that do not exist:\n${bad.join("\n")}`).toEqual([]);
  });
});
