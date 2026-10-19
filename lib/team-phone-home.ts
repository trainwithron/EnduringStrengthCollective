import { teamSportMenu, type TeamMenuItem } from "@/lib/team-sport";

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
  // Only the phone app's own places (lib/phone-coach-routes.ts): the organization's programs (the coach-level page), Nutrition and Attendance. Depth chart, Team performance, Challenges, Hall of fame,
  // Team sheet and the exercise library are computer pages; a phone that opens one goes to the closest phone place.
  const moreLinks: TeamMenuItem[] = [
    { key: "programs", label: "All programs", href: "/programs" },
    { key: "nutrition", label: "Nutrition", href: `/groups/${groupId}/nutrition` },
    pick("attendance"),
  ];
  return {
    program: program ? { name: program.name, summary: programSummary(program.workouts), href: `/groups/${groupId}/programs/${program.id}` } : null,
    newProgramHref: `/groups/${groupId}/programs/new`,
    links,
    moreLinks,
  };
}
