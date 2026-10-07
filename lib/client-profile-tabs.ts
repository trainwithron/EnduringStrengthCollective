// The sections a coach can switch between on one client's profile. Pure (no React) so the server page can read the tab from the address.
export type ClientProfileTab = "overview" | "program" | "nutrition" | "progress" | "forms" | "settings";

export const CLIENT_PROFILE_TABS: { key: ClientProfileTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "program", label: "Programs" },
  { key: "nutrition", label: "Nutrition" },
  { key: "progress", label: "Progress" },
  { key: "forms", label: "Forms & notes" },
  { key: "settings", label: "Billing & settings" },
];

export function isClientProfileTab(value: string | null | undefined): value is ClientProfileTab {
  return CLIENT_PROFILE_TABS.some((t) => t.key === value);
}
