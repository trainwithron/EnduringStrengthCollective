// Which way the coach likes their Clients page: cards (the default) or a plain list. Kept in this browser only (a per-device preference, nothing to sync), and always safe to read:
// private windows and blocked storage throw, so any failure just means "use the default".

export type ClientsView = "cards" | "list";
export const CLIENTS_VIEW_KEY = "clients-view";
export const DEFAULT_CLIENTS_VIEW: ClientsView = "cards";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readClientsView(storage: StorageLike | null | undefined): ClientsView {
  try {
    const v = storage?.getItem(CLIENTS_VIEW_KEY);
    return v === "list" || v === "cards" ? v : DEFAULT_CLIENTS_VIEW;
  } catch {
    return DEFAULT_CLIENTS_VIEW;
  }
}

export function writeClientsView(storage: StorageLike | null | undefined, view: ClientsView): void {
  try {
    storage?.setItem(CLIENTS_VIEW_KEY, view);
  } catch {
    // the choice still applies for this visit; it just is not remembered
  }
}
