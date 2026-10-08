// The sections a coach can switch between on one client's profile. Pure (no React) so the server page can read the tab from the address.
export type ClientProfileTab = "overview" | "messages" | "program" | "nutrition" | "calendar" | "progress" | "forms" | "settings";

export const CLIENT_PROFILE_TABS: { key: ClientProfileTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "messages", label: "Messages" },
  { key: "program", label: "Programs" },
  { key: "nutrition", label: "Nutrition" },
  { key: "calendar", label: "Calendar" },
  { key: "progress", label: "Progress" },
  { key: "forms", label: "Forms & notes" },
  { key: "settings", label: "Billing & settings" },
];

// Messages and Calendar are loaded when you open them (a conversation and a month of the calendar are too much to load for every profile view); the others are already on the
// page, so they switch instantly.
export const LOADED_ON_OPEN: ClientProfileTab[] = ["messages", "calendar"];

export function isClientProfileTab(value: string | null | undefined): value is ClientProfileTab {
  return CLIENT_PROFILE_TABS.some((t) => t.key === value);
}
