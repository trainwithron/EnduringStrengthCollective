// A long list of ids in a request's URL (.in(...)) can pass the URL limit, which makes the whole request return no rows without an error. Ids go in groups of 100.
export function chunk<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
