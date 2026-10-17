import { chunk } from "@/lib/chunk";
import { pageAll, type PageQuery } from "@/lib/page-all";

// A coach with 1,500 one-on-one clients has 1,500 groups. Two limits break a read over "all my groups" at that size, and both fail QUIETLY:
//   - the ids in a `.in(...)` ride in the request's URL, and past the URL limit the whole request returns no rows (no error the page can tell from "nothing there");
//   - a request returns at most 1,000 rows, and the rest are dropped without a word.
// So the ids go in groups of 100 and each group is read a page at a time. The groups are read a few at a time (not 15 at once) so one page render does not flood the database.
// The query inside must be ordered by something unique (usually `id`) so pages never overlap or skip. A failed group is reported (`failed`), never read as "no rows".
export interface ReadByIdsResult {
  rows: any[];
  failed: boolean;
  truncated: boolean;
}

export interface ReadByIdsOptions {
  chunkSize?: number;
  concurrency?: number;
  maxPages?: number;
  // Rows per request (default 1,000, the most a request returns). A "first N" read passes N with maxPages 1.
  pageSize?: number;
}

export async function readByIds(ids: string[], make: (idChunk: string[]) => PageQuery, opts: ReadByIdsOptions = {}): Promise<ReadByIdsResult> {
  const groups = chunk([...new Set(ids)], opts.chunkSize ?? 100);
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const rows: any[] = [];
  let failed = false;
  let truncated = false;
  for (let i = 0; i < groups.length; i += concurrency) {
    const results = await Promise.all(groups.slice(i, i + concurrency).map((g) => pageAll(make(g), { maxPages: opts.maxPages ?? 25, pageSize: opts.pageSize })));
    for (const r of results) {
      rows.push(...r.rows);
      if (r.failed) failed = true;
      if (r.truncated) truncated = true;
    }
  }
  return { rows, failed, truncated };
}

// A head count (`select("id", { count: "exact", head: true })`) over many ids: one count per group of ids, added up. A failed group reports `failed` and the count so far.
export async function countByIds(ids: string[], make: (idChunk: string[]) => PromiseLike<{ count: number | null; error: unknown }>, opts: { chunkSize?: number; concurrency?: number } = {}): Promise<{ count: number; failed: boolean }> {
  const groups = chunk([...new Set(ids)], opts.chunkSize ?? 100);
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  let count = 0;
  let failed = false;
  for (let i = 0; i < groups.length; i += concurrency) {
    const results = await Promise.all(groups.slice(i, i + concurrency).map((g) => make(g)));
    for (const r of results) {
      if (r.error) failed = true;
      else count += r.count ?? 0;
    }
  }
  return { count, failed };
}

// The same as readByIds, in the `{ data, error }` shape a plain Supabase read returns, so a page that destructures `{ data: rows }` changes only where the rows come from. `error` is set when any group failed
// (the rows that did come back are still in `data`); `truncated` when a group hit the page ceiling.
export async function readRowsByIds(ids: string[], make: (idChunk: string[]) => PageQuery, opts: ReadByIdsOptions = {}): Promise<{ data: any[]; error: Error | null; truncated: boolean }> {
  const r = await readByIds(ids, make, opts);
  return { data: r.rows, error: r.failed ? new Error("A read over many groups failed.") : null, truncated: r.truncated };
}
