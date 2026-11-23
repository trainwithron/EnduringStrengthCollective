// The pure parts of scripts/usda-food-load.mjs (step 223): reading .env.local, the list of JSON batches, and one call to public.load_usda_food_batch. No network of its own (the fetch
// is passed in), so it can be tested. The server key is only ever put in the request headers; nothing here prints or returns it.

// KEY=VALUE lines, # comments and blank lines skipped, surrounding quotes removed.
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

// The batches to send, in order, from the importer's index.json (written with --json).
export function batchFiles(index) {
  const files = Array.isArray(index?.jsonFiles) ? index.jsonFiles : [];
  if (files.length === 0) throw new Error("index.json lists no JSON batches: run scripts/usda-import.mjs with --json first");
  for (const f of files) if (!/^batch-\d{3,}\.json$/.test(f)) throw new Error(`unexpected batch file name in index.json: ${f}`);
  return [...files].sort();
}

// One batch: POST /rest/v1/rpc/load_usda_food_batch. Returns { ok: true, rows } (0 = it was already loaded) or { ok: false, error } with the response text (never the key).
export async function sendBatch(fetchImpl, supabaseUrl, serviceKey, bodyText) {
  const url = `${String(supabaseUrl).replace(/\/+$/, "")}/rest/v1/rpc/load_usda_food_batch`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: bodyText,
    });
  } catch (e) {
    return { ok: false, error: `the request did not go through: ${String(e?.message ?? e).replaceAll(serviceKey, "[key]")}` };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `${res.status}: ${text.replaceAll(serviceKey, "[key]").slice(0, 500)}` };
  const rows = Number(JSON.parse(text));
  return Number.isInteger(rows) && rows >= 0 ? { ok: true, rows } : { ok: false, error: `unexpected answer: ${text.slice(0, 200)}` };
}
