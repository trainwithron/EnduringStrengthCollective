import { teamSportMenu, type TeamMenuItem } from "@/lib/team-sport";
import { pickUpWhereLeftOff, pickupLabel } from "@/lib/program-pickup";

// What a team-sport coach sees first on a phone (pure, so it is tested with the real row shapes). Ron, Oct 20: "Coaches like Cade keep their team home ... they should have a list of the programs.
// Whatever he's running and whatever a football coach might need." Every active team program as a card (Start or Continue, where it is up to, and who it is for), then Team calendar,
// Athletes, Attendance, Messages, Team feed, Settings, and ONE "More tools". No money anywhere, nothing that asks the coach to add a client.
export interface TeamPhoneProgram {
  id: string;
  name: string;
  label?: string | null;
  workouts: { id: string; week_number: number | null; day_index: number | null; title?: string | null }[];
}

export interface TeamPhoneProgramCard {
  id: string;
  name: string;
  summary: string;
  // "Up next: Week 2, Day 1", "Program complete" or "Nothing in it yet": the same pointer the program view opens on.
  upNext: string;
  // "For: Football (12), Baseball (3)" from the athletes the program was given to, by position; null when it was given to nobody yet.
  forLine: string | null;
  href: string;
  cta: "Start" | "Continue";
}

export interface TeamPhoneHome {
  programs: TeamPhoneProgramCard[];
  newProgramHref: string;
  /** in this order */
  links: TeamMenuItem[];
  moreLinks: TeamMenuItem[];
}

/** "8 weeks, 3 days a week" from a program's workouts (undated programs have week and day numbers, not dates). */
export function programSummary(workouts: { week_number: number | null; day_index: number | null }[]): string {
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

/** "For: Football (12), Baseball (3)", biggest first; null with nobody. */
export function forLine(byPosition: { name: string; count: number }[] | undefined): string | null {
  const parts = (byPosition ?? []).filter((p) => p.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return parts.length > 0 ? `For: ${parts.map((p) => `${p.name} (${p.count})`).join(", ")}` : null;
}

export function teamPhoneHome({
  groupId,
  programs,
  doneAt = new Map(),
  forByProgram = new Map(),
}: {
  groupId: string;
  programs: TeamPhoneProgram[];
  doneAt?: ReadonlyMap<string, string>;
  forByProgram?: ReadonlyMap<string, { name: string; count: number }[]>;
}): TeamPhoneHome {
  const menu = teamSportMenu(groupId);
  const pick = (key: string) => menu.find((m) => m.key === key)!;
  const links: TeamMenuItem[] = [pick("team-calendar"), pick("members"), pick("attendance"), pick("messages"), pick("feed"), { key: "settings", label: "Settings", href: `/groups/${groupId}/settings` }];
  // Only the phone app's own places (lib/phone-coach-routes.ts): the organization's programs (the coach-level page) and Nutrition. Depth chart, Team performance, Challenges, Hall of fame,
  // Team sheet and the exercise library are computer pages; a phone that opens one goes to the closest phone place.
  const moreLinks: TeamMenuItem[] = [
    { key: "programs", label: "All programs", href: "/programs" },
    { key: "nutrition", label: "Nutrition", href: `/groups/${groupId}/nutrition` },
  ];
  return {
    programs: programs.map((p) => {
      const pickup = pickUpWhereLeftOff(p.workouts, doneAt);
      const label = pickupLabel(pickup);
      return {
        id: p.id,
        name: p.label?.trim() || p.name,
        summary: programSummary(p.workouts),
        upNext: pickup.kind === "next" ? `Up next: ${label}` : label,
        forLine: forLine(forByProgram.get(p.id)),
        href: `/groups/${groupId}/programs/${p.id}`,
        cta: p.workouts.some((w) => doneAt.has(w.id)) ? "Continue" : "Start",
      };
    }),
    newProgramHref: `/groups/${groupId}/programs/new`,
    links,
    moreLinks,
  };
}
