// Bulk announcement merge. One token, {first_name}, replaced with the
// recipient's first name — derived the same way every other message in
// this app derives it (full_name split on whitespace, no first_name
// column exists). A blank name falls back to "there" so a message never
// goes out reading "Hey , ...".
export const FIRST_NAME_TOKEN = "{first_name}";
export const MAX_BROADCAST_LENGTH = 1000;

export function firstNameOf(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

export function mergeFirstName(template: string, fullName: string | null | undefined): string {
  return template.split(FIRST_NAME_TOKEN).join(firstNameOf(fullName));
}
