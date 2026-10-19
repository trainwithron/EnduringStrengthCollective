import { teamSportMenu, teamSportMoreMenu, type TeamMenuItem } from "@/lib/team-sport";

// What a team-sport coach sees first on a phone (pure, so it is tested with the real row shapes): the group's active program, then Team calendar, Team feed, Athletes, Messages, Settings, and ONE "More tools" that
// holds everything else. No money anywhere, nothing that asks the coach to add a client or build a program they already have.
export interface TeamPhoneProgram {
  id: string;
  name: string;
  workouts: { week_number: number | null; day_index: number | null }[];
}

export interface TeamPhoneHome {
  program: { name: string; summary: string; href: string } | null;
  newProgramHref: string;
  /** in this order */
  links: TeamMenuItem[];
  moreLinks: TeamMenuItem[];
}

/** "8 weeks, 3 days a week" from a program's workouts (undated programs have week and day numbers, not dates). */
export function programSummary(workouts: TeamPhoneProgram["workouts"]): string {
  if (workouts.length === 0) return "No workouts yet";
  const perWeek = new Map<number, number>();
  for (const w of workouts) {
    const wk = w.week_number && w.week_number > 0 ? w.week_number : 1;
    perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1);
  }
  const weeks = Math.max(...perWeek.keys());
  const days = Math.max(...perWeek.values());
  return `${weeks} ${weeks === 1 ? "week" : "weeks"}, ${days} ${days === 1 ? "day" : "days"} a week`;
}

export function teamPhoneHome({ groupId, program }: { groupId: string; program: TeamPhoneProgram | null }): TeamPhoneHome {
  const menu = teamSportMenu(groupId);
  const pick = (key: string) => menu.find((m) => m.key === key)!;
  const links: TeamMenuItem[] = [pick("team-calendar"), pick("feed"), pick("members"), pick("messages"), { key: "settings", label: "Settings", href: `/groups/${groupId}/settings` }];
  const shown = new Set(links.map((l) => l.key));
  const moreLinks: TeamMenuItem[] = [
    // the organization's programs (the coach-level page), the rest of the team menu, then the other tools
    { key: "programs", label: "All programs", href: "/programs" },
    ...menu.filter((m) => !shown.has(m.key)),
    ...teamSportMoreMenu(groupId),
    { key: "exercise-library", label: "Exercise library", href: `/groups/${groupId}/exercise-library` },
    { key: "nutrition", label: "Nutrition", href: `/groups/${groupId}/nutrition` },
    { key: "my-training", label: "My own training", href: "/my-space?view=client" },
  ];
  return {
    program: program ? { name: program.name, summary: programSummary(program.workouts), href: `/groups/${groupId}/programs/${program.id}` } : null,
    newProgramHref: `/groups/${groupId}/programs/new`,
    links,
    moreLinks,
  };
}
