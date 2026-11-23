// Loads the USDA Branded Foods JSON batches (scripts/usda-branded-import.mjs --json) into the database, one call per batch, through public.load_usda_branded_batch (migration
// 0468, step 224: it must be applied first). Each call is all-or-nothing and records the batch's marker, so this is safe to run again: batches already loaded are skipped, and an
// interrupted load simply carries on. It stops at the first error.
//
//   node scripts/usda-branded-load.mjs <folder with index.json and batch-0001.json ...> --dry-run     (reads the markers only: what is loaded, what is still to load)
//   node scripts/usda-branded-load.mjs <folder>                                                       (loads what is still to load, in order)
//
// It reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local in the folder it is run from (or from the environment). The key is sent only to that database and is
// never printed. A person runs this, on purpose, after the paste; never the app or a deploy.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvText, pendingBatches } from "./usda-branded-lib.mjs";

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
if (!folder || !existsSync(join(folder, "index.json"))) {
  console.error("Usage: node scripts/usda-branded-load.mjs <folder with index.json from usda-branded-import.mjs --json> [--dry-run]");
  process.exit(1);
}
const index = JSON.parse(readFileSync(join(folder, "index.json"), "utf8"));
if (index.format !== "json" || !Array.isArray(index.batches)) {
  console.error("That folder holds SQL batches. Write JSON ones with: node scripts/usda-branded-import.mjs <csv folder> --name <label> --out <dir> --json");
  process.exit(1);
}

const env = { ...(existsSync(".env.local") ? parseEnvText(readFileSync(".env.local", "utf8")) : {}), ...process.env };
const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!/^https:\/\/[a-z0-9.-]+$/i.test(url) || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL (https) and SUPABASE_SERVICE_ROLE_KEY are needed, in .env.local or the environment.");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

// The branded batch markers already in the database.
async function loadedNames() {
  const names = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/rest/v1/usda_load_batches?select=name&name=like.branded-*&order=name&limit=1000&offset=${offset}`, { headers });
    if (!res.ok) throw new Error(`reading the load markers: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const page = await res.json();
    names.push(...page.map((r) => r.name));
    if (page.length < 1000) return names;
  }
}

const loaded = await loadedNames();
const todo = pendingBatches(index.batches, loaded);
console.log(`${index.batches.length} batches in ${folder}: ${index.batches.length - todo.length} already loaded, ${todo.length} to load (${index.products} products in all).`);
if (dryRun || todo.length === 0) {
  console.log(dryRun ? "Dry run: nothing was loaded." : "Nothing to do.");
  process.exit(0);
}

let done = 0;
for (const b of todo) {
  const body = readFileSync(join(folder, b.file), "utf8");
  const parsed = JSON.parse(body);
  if (parsed.p_name !== b.name) {
    console.error(`${b.file}: its batch name ${parsed.p_name} is not the one in index.json (${b.name}). Stopped.`);
    process.exit(1);
  }
  const t0 = Date.now();
  const res = await fetch(`${url}/rest/v1/rpc/load_usda_branded_batch`, { method: "POST", headers, body });
  if (!res.ok) {
    console.error(`${b.file} (${b.name}) failed: ${res.status} ${(await res.text()).slice(0, 500)}`);
    console.error(`Stopped. ${done} loaded this run; nothing of ${b.name} was kept. Fix it and run this again: what is loaded is skipped.`);
    process.exit(1);
  }
  const rows = await res.json();
  done++;
  console.log(`${b.file} ${b.name}: ${rows === 0 ? "already loaded" : `${rows} products`} (${Date.now() - t0} ms) [${done}/${todo.length}]`);
}
console.log(`Done: ${done} batches loaded.`);
