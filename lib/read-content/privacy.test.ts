import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// A client's Read switch is theirs alone: not their coach's, not an org admin's, not the platform admin's. The database already refuses to show the row to anyone else;
// this keeps the app from growing a code path that even asks. Only these files may touch the table, and every one of them acts as the signed-in client on their own row
// (the data export is the client downloading their own data).
const ALLOWED = new Set([
  "app/(coach)/groups/[groupId]/settings/page.tsx",
  "app/api/account/export/route.ts",
  "components/athlete/read-during-rest-toggle.tsx",
  "components/session/read-slot.tsx",
]);

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git" || name === "supabase" || name === "scripts" || name === "docs") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
}

describe("read_settings stays private to the client", () => {
  it("is only touched by the client's own settings and the Read panel", () => {
    const root = process.cwd();
    const files: string[] = [];
    for (const top of ["app", "components", "lib"]) walk(join(root, top), files);
    const touching = files
      .filter((f) => readFileSync(f, "utf8").includes("read_settings"))
      .map((f) => relative(root, f).split("\\").join("/"))
      .sort();
    expect(touching).toEqual([...ALLOWED].sort());
  });
});
