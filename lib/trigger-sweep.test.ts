import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TRIGGER_SWEEP } from "../scripts/function-acl.mjs";

// Step 53 closes trigger functions to signed-in users. That is only safe for a function nothing calls through the API, so this proves no app code calls one with .rpc().
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("the trigger function sweep (step 53)", () => {
  it("lists each function once", () => {
    expect(new Set(TRIGGER_SWEEP).size).toBe(TRIGGER_SWEEP.length);
    expect(TRIGGER_SWEEP.length).toBeGreaterThan(40);
  });
  it("no app code calls any of them through the API", () => {
    const files = ["app", "lib", "components"].flatMap((d) => sourceFiles(join(process.cwd(), d)));
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const name of TRIGGER_SWEEP as string[]) {
        if (text.includes(`.rpc("${name}"`) || text.includes(`.rpc('${name}'`) || text.includes(`.rpc(\`${name}\``)) hits.push(`${f}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
