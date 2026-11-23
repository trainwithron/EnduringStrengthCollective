// Loads the everyday-food batches (step 223) into the database through public.load_usda_food_batch, with the server key. For the batches written by
//   node scripts/usda-import.mjs <USDA folder> --name <label> --out <dir> --json
// then
//   node scripts/usda-food-load.mjs <dir> --dry-run     (reads the batches and .env.local, says what it WOULD send; sends nothing)
//   node scripts/usda-food-load.mjs <dir>               (sends them in order)
//
// Each batch loads completely or not at all and records itself in public.usda_load_batches, so a batch already loaded answers 0 and is skipped: run it again after any stop and it
// carries on. It stops at the first error and says which batch. NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come from .env.local in the folder it is run from (or --env
// <file>); the key is never printed. Step 223 must be applied first. A person runs this on purpose; the app and deploys never do.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { batchFiles, parseEnvFile, sendBatch } from "./usda-food-load-lib.mjs";

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--env");
const dryRun = args.includes("--dry-run");
const envPath = valueOf("--env") ?? join(process.cwd(), ".env.local");

if (!dir || !existsSync(join(dir, "index.json"))) {
  console.error("Usage: node scripts/usda-food-load.mjs <folder with index.json and batch-NNN.json> [--dry-run] [--env <.env file>]");
  process.exit(1);
}
const env = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : {};
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (looked in ${envPath} and the environment).`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
const files = batchFiles(index);
console.log(`${files.length} batches (${index.mode ?? "add"} mode, ${index.foods ?? "?"} foods) for ${new URL(url).host}${dryRun ? " -- DRY RUN, nothing is sent" : ""}`);

let loaded = 0;
let skipped = 0;
for (const [i, f] of files.entries()) {
  const body = readFileSync(join(dir, f), "utf8");
  const parsed = JSON.parse(body);
  const counts = `${parsed.p_foods?.length ?? 0} foods, ${parsed.p_nutrients?.length ?? 0} nutrient rows, ${parsed.p_portions?.length ?? 0} portions`;
  if (dryRun) {
    console.log(`  [${i + 1}/${files.length}] ${f} (${parsed.p_name}): would send ${counts}, ${body.length} bytes`);
    continue;
  }
  const r = await sendBatch(fetch, url, key, body);
  if (!r.ok) {
    console.error(`  [${i + 1}/${files.length}] ${f} (${parsed.p_name}) FAILED, nothing of it was loaded: ${r.error}`);
    console.error(`Stopped. ${loaded} batches loaded, ${skipped} were already there. Fix the cause and run the same command again: finished batches are skipped.`);
    process.exit(1);
  }
  if (r.rows === 0) skipped += 1;
  else loaded += 1;
  console.log(`  [${i + 1}/${files.length}] ${f} (${parsed.p_name}): ${r.rows === 0 ? "already loaded, skipped" : `loaded ${r.rows} rows (${counts})`}`);
}
console.log(dryRun ? "Dry run done. Nothing was sent." : `Done: ${loaded} batches loaded, ${skipped} already there.`);
