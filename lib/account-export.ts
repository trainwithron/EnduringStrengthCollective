// "Download my data": the part that collects everything the database holds about the signed-in person, one table and one page at a time (migration 0412), and the delivery of a download too large to send directly.
//
// Every page is its own short database call, so one slow table can only cost that table, never the whole download. Nothing is dropped silently: a table that could not be read in full is named with the reason, a table cut at the
// limit says it was cut (the newest rows are kept), and a table left out because the download limit was reached says so.

export const EXPORT_BUCKET = "account-exports";
export const PAGE_ROWS = 1000;
export const MAX_ROWS_PER_TABLE = 50_000;
export const MAX_TOTAL_ROWS = 300_000;
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
export const TIME_BUDGET_MS = 35_000;
const CONCURRENCY = 4;
// A response over about 4.5 MB is refused by the host, so anything over this is handed over as a short-lived private link instead.
export const INLINE_LIMIT_BYTES = 4_000_000;
export const LINK_SECONDS = 300;
export const KEEP_FILE_MS = 24 * 3600 * 1000;

export interface ExportTable {
  rows: Record<string, unknown>[];
  truncated: boolean;
  /** Why the table is not complete, in plain words. Absent when it is complete. */
  note?: string;
}

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
export interface ExportClient {
  rpc: Rpc;
}

const TIMEOUT_NOTE = "This table took too long to read, so only part of it is here. Download again in a few minutes.";
const ERROR_NOTE = "This table could not be read this time, so it is left out or partly here. Download again in a few minutes.";

export const noteFor = (error: { message: string; code?: string }): string => (error.code === "57014" || /statement timeout|canceling statement/i.test(error.message) ? TIMEOUT_NOTE : ERROR_NOTE);

/**
 * Reads every table that names the person, a page at a time. Returns null when the list of tables itself cannot be read (the function is not in the database yet, or the call failed);
 * the caller then sends the short list it always had.
 */
export async function collectEverything(
  client: ExportClient,
  options: { now?: () => number; pageRows?: number; maxRowsPerTable?: number; maxTotalRows?: number; maxTotalBytes?: number; timeBudgetMs?: number } = {},
): Promise<{ tables: Record<string, ExportTable>; complete: boolean } | null> {
  const now = options.now ?? Date.now;
  const pageRows = options.pageRows ?? PAGE_ROWS;
  const perTable = options.maxRowsPerTable ?? MAX_ROWS_PER_TABLE;
  const total = options.maxTotalRows ?? MAX_TOTAL_ROWS;
  const maxBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const started = now();
  const budget = options.timeBudgetMs ?? TIME_BUDGET_MS;

  const listed = await client.rpc("export_my_data_tables");
  if (listed.error || !Array.isArray(listed.data)) return null;
  const pairs = (listed.data as { tbl: string; col: string }[]).filter((p) => p && typeof p.tbl === "string" && typeof p.col === "string");

  const tables: Record<string, ExportTable> = {};
  let used = 0;
  let bytes = 0;
  let complete = true;
  let next = 0;

  async function readOne(tbl: string, col: string) {
    const key = `${tbl}.${col}`;
    const out: ExportTable = { rows: [], truncated: false };
    for (let offset = 0; ; offset += pageRows) {
      if (used >= total || bytes >= maxBytes) {
        out.truncated = true;
        out.note = "Left out: the download reached its size limit.";
        break;
      }
      if (now() - started > budget) {
        out.truncated = true;
        out.note = "Left out: the download ran out of time. Download again to get the rest.";
        break;
      }
      const room = Math.min(pageRows, perTable - out.rows.length, total - used);
      // rows are reserved before the call so tables read side by side cannot together pass the total
      used += room;
      const page = await client.rpc("export_my_data_table", { p_table: tbl, p_col: col, p_offset: offset, p_limit: room });
      if (page.error || !page.data || typeof page.data !== "object") {
        used -= room;
        out.truncated = out.rows.length > 0;
        out.note = page.error ? noteFor(page.error) : ERROR_NOTE;
        break;
      }
      const got = ((page.data as { rows?: unknown }).rows ?? []) as Record<string, unknown>[];
      const more = Boolean((page.data as { more?: unknown }).more);
      out.rows.push(...got);
      bytes += JSON.stringify(got).length;
      used -= room - got.length;
      if (!more) break;
      if (out.rows.length >= perTable) {
        out.truncated = true;
        out.note = `Only the newest ${perTable.toLocaleString("en-US")} rows are here.`;
        break;
      }
    }
    if (out.note) complete = false;
    if (out.rows.length > 0 || out.note) tables[key] = out;
  }

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= pairs.length) return;
      await readOne(pairs[i].tbl, pairs[i].col);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, worker));

  // stable order in the file
  const sorted: Record<string, ExportTable> = {};
  for (const k of Object.keys(tables).sort()) sorted[k] = tables[k];
  return { tables: sorted, complete };
}

export const deliveryFor = (bytes: number): "inline" | "link" => (bytes > INLINE_LIMIT_BYTES ? "link" : "inline");

/** Stores a large download in the private bucket and returns a short-lived link, or null when it could not be stored. */
export async function storeAccountExport(db: any, userId: string, body: string, now: Date = new Date()): Promise<string | null> {
  try {
    const path = `${userId}-${now.getTime()}.json`;
    const { error } = await db.storage.from(EXPORT_BUCKET).upload(path, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: false });
    if (error) return null;
    const { data, error: signError } = await db.storage.from(EXPORT_BUCKET).createSignedUrl(path, LINK_SECONDS, { download: "my-data.json" });
    if (signError || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Deletes stored downloads older than a day. Returns how many were removed. A listing that fails removes nothing. */
export async function sweepAccountExports(db: any, now: Date = new Date()): Promise<number> {
  try {
    const bucket = db.storage.from(EXPORT_BUCKET);
    const cutoff = now.getTime() - KEEP_FILE_MS;
    let removed = 0;
    for (let round = 0; round < 20; round++) {
      const { data, error } = await bucket.list("", { limit: 100, sortBy: { column: "created_at", order: "asc" } });
      if (error) return removed;
      const old = ((data ?? []) as { name: string; created_at?: string }[]).filter((f) => !!f.created_at && new Date(f.created_at).getTime() < cutoff).map((f) => f.name);
      if (old.length === 0) return removed;
      const { error: removeError } = await bucket.remove(old);
      if (removeError) return removed;
      removed += old.length;
      if (old.length < 100) return removed;
    }
    return removed;
  } catch {
    return 0;
  }
}
