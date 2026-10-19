// The title of the coach's phone Home: the organization's name, with the group's own name under it when it differs. A client's own space (a one-on-one group) keeps the client's name as the title: that page is
// about the client, not the organization. With no organization known it is the group's name, as before.
export function homeTitle(pageGroup: { kind: string; orgName: string } | undefined, groupName: string): { main: string; sub: string | null } {
  if (!pageGroup || pageGroup.kind === "one_on_one" || !pageGroup.orgName.trim()) return { main: groupName, sub: null };
  const same = pageGroup.orgName.trim().toLowerCase() === groupName.trim().toLowerCase();
  return { main: pageGroup.orgName, sub: same ? null : groupName };
}
