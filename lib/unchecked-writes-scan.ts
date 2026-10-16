// Finds writes to the database in screen code whose result is thrown away: a statement that STARTS with `await supabase` (nothing assigned, nothing returned) and is an insert, update, upsert, delete or rpc.
// The browser client never throws; a failed write (or one that row security turns into "0 rows changed") looks identical to a saved one unless the result is looked at (see lib/checked-write.ts).
const WRITE = /\.(insert|update|upsert|delete|rpc)\(/;

export function uncheckedWrites(source: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*await\s+supabase\b/.test(lines[i])) continue;
    // the whole statement, up to the line that ends it
    let statement = lines[i];
    let j = i;
    while (!/;\s*(\/\/.*)?$/.test(lines[j]) && j < lines.length - 1 && j - i < 40) {
      j++;
      statement += "\n" + lines[j];
    }
    if (WRITE.test(statement) && !/\.select\b[^;]*\bchecked\b/.test(statement)) found.push({ line: i + 1, text: lines[i].trim().slice(0, 100) });
  }
  return found;
}
