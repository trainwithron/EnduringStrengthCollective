// What the coach is told when a visitor (someone who booked from the public page, with no account) cancels or moves their booking through their private link. One line, plain.
export function visitorChangeNotice(input: { guestName: string; typeName: string | null; oldWhen: string } & ({ kind: "cancelled" } | { kind: "moved"; newWhen: string })): { title: string; body: string } {
  const who = input.guestName.trim() || "A visitor";
  const what = input.typeName?.trim() || "their session";
  if (input.kind === "cancelled") return { title: "Booking cancelled", body: `${who} cancelled ${what} (${input.oldWhen}).` };
  return { title: "Booking moved", body: `${who} moved ${what} from ${input.oldWhen} to ${input.newWhen}.` };
}
