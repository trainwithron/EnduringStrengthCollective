// Where "Clients" and "Members" lead (Ron, Oct 6: "the client button needs to pull up my FULL client list... unless very specifically I want to see all the
// members of a group"). Clients is ALWAYS coach-level: every client the coach has, wherever the coach is standing (Home, a team group, a one-on-one client's
// space). Members is the other thing: one team or social group's own roster, offered only inside such a group. The word "Clients" never means "this group's members".

export type GroupKindLite = "one_on_one" | "social" | "team" | null | undefined;

export const CLIENTS_HREF = "/clients";

export function membersHref(groupId: string): string {
  return `/groups/${groupId}/clients?view=members`;
}

// Members is shown only inside a team or social group (never in a one-on-one client's space, and never on a coach-level page).
export function showsMembers(groupKind: GroupKindLite, coachLevel: boolean): boolean {
  return !coachLevel && (groupKind === "team" || groupKind === "social");
}

// What the group's old clients URL does for a coach on a computer: a one-on-one group, or no `view=members`, goes to the coach-level list; only an explicit
// view=members on a team or social group shows that group's roster.
export function groupClientsDestination(groupKind: GroupKindLite, view: string | undefined): "coach-level" | "members" {
  return view === "members" && (groupKind === "team" || groupKind === "social") ? "members" : "coach-level";
}
