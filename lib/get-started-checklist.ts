import { addSessionsHref } from "@/lib/add-sessions-link";

// "Get <Name> started" on the coach's view of a new client's profile (Ron, Oct 24: "Sure, but it needs to be easily dismissible. Some people have a different workflow").
// Each step ticks itself from what is really there; the card goes away by itself once all four are done, for a client who already logs workouts, and when the coach hides it.
export const SIGN_IN_OPTIONS_ANCHOR = "sign-in-options";
// The coach's own choice to never see the card (on their account, so it follows them to every device).
export const HIDE_GET_STARTED_KEY = "hide_get_started_checklist";
// Hidden for one client (this browser only).
export const getStartedDismissKey = (athleteId: string) => `spotlight:get-started-hidden:${athleteId}`;

type KeyStore = Pick<Storage, "getItem" | "setItem">;

// A browser that cannot store (private mode) simply shows the card; nothing breaks.
export function hiddenForClient(store: KeyStore | null, athleteId: string): boolean {
  try {
    return store?.getItem(getStartedDismissKey(athleteId)) === "1";
  } catch {
    return false;
  }
}

export function hideForClient(store: KeyStore | null, athleteId: string): void {
  try {
    store?.setItem(getStartedDismissKey(athleteId), "1");
  } catch {}
}

export interface GetStartedFacts {
  hasProgram: boolean;
  // Sessions on their balance, sessions ever added, or a package assigned to them.
  hasSessions: boolean;
  // A session on the calendar that has not been settled yet.
  onCalendar: boolean;
  // They have signed in, or a sign-in link was made for them.
  signInSent: boolean;
}

export interface GetStartedStep {
  key: "program" | "sessions" | "calendar" | "signin";
  label: string;
  done: boolean;
  href: string;
}

export function getStartedSteps(facts: GetStartedFacts, groupId: string, athleteId: string): GetStartedStep[] {
  return [
    { key: "program", label: "Assign a program", done: facts.hasProgram, href: `/groups/${groupId}/athletes/${athleteId}?tab=program` },
    { key: "sessions", label: "Add sessions", done: facts.hasSessions, href: addSessionsHref(groupId, athleteId) },
    { key: "calendar", label: "Put them on the calendar", done: facts.onCalendar, href: `/groups/${groupId}/calendar?client=${athleteId}&scheduleFor=${athleteId}` },
    { key: "signin", label: "Send their sign-in link", done: facts.signInSent, href: `/groups/${groupId}/athletes/${athleteId}?tab=settings#${SIGN_IN_OPTIONS_ANCHOR}` },
  ];
}

// Shown only to a coach looking at someone else, while a step is open, for a client with no logged workouts, unless the coach turned it off.
export function showGetStarted(input: { selfView: boolean; loggedWorkouts: number; hiddenForAll: boolean; steps: GetStartedStep[] }): boolean {
  if (input.selfView || input.hiddenForAll || input.loggedWorkouts > 0) return false;
  return input.steps.some((s) => !s.done);
}
