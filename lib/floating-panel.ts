// The floating Spot | Messages panel (components/coach/desktop/collective-intelligence-chat.tsx), pure parts.

export type PanelTab = "spot" | "messages";

// The panel's header says which tab is showing: "Ask Spot / Find a page..." only on Spot.
export function panelHeader(tab: PanelTab): { title: string; subtitle: string; collapseLabel: string } {
  return tab === "messages"
    ? { title: "Messages", subtitle: "Pick a client to read and reply.", collapseLabel: "Collapse Messages" }
    : { title: "Ask Spot", subtitle: "Find a page, learn how to do something, or ask about a client.", collapseLabel: "Collapse Ask Spot chat" };
}

// The unread count the panel shows: the count the page loaded with, less the messages read since in the panel (each thread counted once). Never below zero.
export function shownUnread(loaded: number, readSince: number): number {
  return Math.max(0, loaded - readSince);
}

// Reading a thread in the panel takes that thread's unread messages off the badge, once. `counted` is the threads already taken off.
export function afterThreadOpened(counted: ReadonlySet<string>, readSince: number, otherId: string, threadUnread: number): { counted: Set<string>; readSince: number } {
  if (counted.has(otherId) || threadUnread <= 0) return { counted: new Set(counted), readSince };
  return { counted: new Set(counted).add(otherId), readSince: readSince + threadUnread };
}

// The badge text on a tab: the number, or 9+ beyond nine.
export function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count);
}
