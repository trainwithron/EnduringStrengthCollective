// A person's name as typed: spaces collapsed and trimmed, at most 120 characters (the same limit signup uses), never empty, no line breaks or control characters. Null when nothing usable.
export function cleanPersonName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 120) return null;
  return cleaned;
}
