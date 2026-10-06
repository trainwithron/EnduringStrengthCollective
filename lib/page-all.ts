// PostgREST returns at most 1000 rows a request, so a read that can come back with more is read a page at a time (ordered by id so the pages never overlap).
// A failed page is reported, never treated as "no rows".
export type PageQuery = (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>;

export async function pageAll(make: PageQuery, opts: { pageSize?: number; maxPages?: number } = {}): Promise<{ rows: any[]; failed: boolean; truncated: boolean }> {
  const size = opts.pageSize ?? 1000;
  const maxPages = opts.maxPages ?? 25;
  const rows: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await make(page * size, page * size + size - 1);
    if (error) return { rows, failed: true, truncated: false };
    rows.push(...(data ?? []));
    if ((data ?? []).length < size) return { rows, failed: false, truncated: false };
  }
  return { rows, failed: false, truncated: true };
}
