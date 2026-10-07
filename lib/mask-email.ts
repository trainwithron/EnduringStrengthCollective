// "jane.doe@gmail.com" -> "j•••@gmail.com": enough for a coach to see where an email went without showing a client's whole address.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "their email";
  const local = email.slice(0, at);
  return `${local[0]}•••${email.slice(at)}`;
}
