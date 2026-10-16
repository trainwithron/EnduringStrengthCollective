// A write to the database that tells the truth. The browser client returns { data, error } and never throws, so a write that fails (or that row security quietly turns into "0 rows changed") looks exactly like one
// that worked unless the result is looked at. Use this for every write whose result the screen is about to show as done.
//
//   const r = await checked(supabase.from("x").upsert(row).select("id"), { expectRows: true });
//   if (!r.ok) { setError(r.error); return; }
//
// expectRows: the write must come back with at least one row (add .select() to the write). A row-security refusal on an update or delete is "no error, no rows", which is only caught this way.
export interface WriteResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
}

export const DEFAULT_WRITE_ERROR = "That didn't save. Try again.";

export async function checked<T = unknown>(
  operation: PromiseLike<{ data?: T | null; error?: { message?: string } | null }>,
  { expectRows = false, message = DEFAULT_WRITE_ERROR }: { expectRows?: boolean; message?: string } = {}
): Promise<WriteResult<T>> {
  try {
    const { data, error } = await operation;
    if (error) return { ok: false, data: null, error: message };
    if (expectRows) {
      const rows = Array.isArray(data) ? data.length : data == null ? 0 : 1;
      if (rows === 0) return { ok: false, data: null, error: message };
    }
    return { ok: true, data: (data ?? null) as T | null, error: null };
  } catch {
    return { ok: false, data: null, error: message };
  }
}
