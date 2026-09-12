// Pure date-key range expansion for the "hotel booking" style bulk
// macro-assignment tool — pick a start and end date, get every date key
// in between (inclusive), same way a hotel booking calendar expands a
// check-in/check-out pair into every night stayed.
export function enumerateDateKeys(startKey: string, endKey: string, maxDays = 90): string[] {
  const start = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const keys: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && keys.length < maxDays) {
    keys.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
        cursor.getDate()
      ).padStart(2, "0")}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}
