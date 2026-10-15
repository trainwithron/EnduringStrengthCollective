// The sections a coach can switch between on one client's profile. Pure (no React) so the server page can read the tab from the address.
export type ClientProfileTab = "overview" | "program" | "nutrition" | "calendar" | "progress" | "forms" | "settings";

export const CLIENT_PROFILE_TABS: { key: ClientProfileTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "program", label: "Programs" },
  { key: "nutrition", label: "Nutrition" },
  { key: "calendar", label: "Calendar" },
  { key: "progress", label: "Progress" },
  { key: "forms", label: "Forms & notes" },
  { key: "settings", label: "Billing & settings" },
];

// Calendar is loaded when you open it (a month of the calendar is too much to load for every profile view); the others are already on the page, so they switch instantly. The conversation
// with the client is a small box on Overview, not a tab (an old ?tab=messages address opens that box).
export const LOADED_ON_OPEN: ClientProfileTab[] = ["calendar"];

// On the coach's own profile there is no billing to settle.
export const SELF_HIDDEN_TABS: ClientProfileTab[] = ["settings"];

export function isClientProfileTab(value: string | null | undefined): value is ClientProfileTab {
  return CLIENT_PROFILE_TABS.some((t) => t.key === value);
}
