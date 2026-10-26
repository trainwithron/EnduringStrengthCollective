// Whether the coach area must ask the server for the organization's look again (components/shared/org-theme-sync.tsx), and under which key: the remembered workspace or the chosen organization
// differs from what the page was drawn with, and that same difference has not been asked about already. Null = nothing to do. Pure, so it is tested.
export function themeRefreshNeeded(input: { remembered: string | null; chosen: string | null; usedGroup: string; usedOrg: string; alreadyAsked: string | null }): string | null {
  const differs = (input.remembered && input.remembered !== input.usedGroup) || (input.chosen && input.chosen !== input.usedOrg);
  if (!differs) return null;
  const key = `${input.remembered ?? ""}|${input.chosen ?? ""}`;
  return key === input.alreadyAsked ? null : key;
}
