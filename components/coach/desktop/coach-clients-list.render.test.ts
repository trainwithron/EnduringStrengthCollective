import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { CoachClientsList, ClientsCardView, ClientsListView } from "./coach-clients-list";
import { readClientsView, writeClientsView, CLIENTS_VIEW_KEY, DEFAULT_CLIENTS_VIEW } from "@/lib/clients-view-pref";
import type { CoachClientRow } from "@/lib/coach-client-filter";

const ROWS: CoachClientRow[] = [
  { id: "w", fullName: "William Stafford", groupId: "g1", groupName: "William Stafford", groupKind: "one_on_one", tier: null, setAside: false, toBook: 3, owed: 0 },
  { id: "k", fullName: "Karina Ramirez", groupId: "g2", groupName: "Coast to Coast Online", groupKind: "team", tier: "online", setAside: false, toBook: 0, owed: 1 },
  { id: "a", fullName: "Amber Cole", groupId: "g3", groupName: "The Home Team", groupKind: "team", tier: null, setAside: false, toBook: 5, owed: 0 },
];

describe("Cards | List", () => {
  it("opens on Cards by default, with the toggle next to the search box", () => {
    const html = renderToStaticMarkup(createElement(CoachClientsList, { rows: ROWS }));
    expect(DEFAULT_CLIENTS_VIEW).toBe("cards");
    expect(html).toContain('aria-label="Clients"'); // the card grid
    expect(html).not.toContain("divide-y divide-steel/15 border-y");
    expect(html).toContain("Cards");
    expect(html).toContain("List");
    expect(html).toMatch(/aria-pressed="true"[^>]*>(<svg[^>]*><\/svg>|<svg[\s\S]*?<\/svg>)Cards/);
    expect(html.indexOf("Cards")).toBeLessThan(html.indexOf("Search by name"));
  });
  it("both views show exactly the same clients, each opening the client's profile", () => {
    const cards = renderToStaticMarkup(createElement(ClientsCardView, { rows: ROWS }));
    const list = renderToStaticMarkup(createElement(ClientsListView, { rows: ROWS }));
    for (const r of ROWS) {
      expect(cards).toContain(r.fullName);
      expect(list).toContain(r.fullName);
      expect(cards).toContain(`/groups/${r.groupId}/athletes/${r.id}`);
      expect(list).toContain(`/groups/${r.groupId}/athletes/${r.id}`);
    }
    expect(cards.match(/<li/g)!.length).toBe(ROWS.length);
    expect(list.match(/<li/g)!.length).toBe(ROWS.length);
  });
  it("a card carries the kind, the space, and the one quiet number: sessions left to schedule (and owed)", () => {
    const cards = renderToStaticMarkup(createElement(ClientsCardView, { rows: ROWS }));
    expect(cards).toContain("1-on-1");
    expect(cards).toContain("Online");
    expect(cards).toContain("Coast to Coast Online");
    expect(cards).toContain("3 left to schedule");
    expect(cards).toContain("to schedule");
    expect(cards).toContain("owed 1");
  });
  it("cards are tap-sized links in a responsive grid", () => {
    const cards = renderToStaticMarkup(createElement(ClientsCardView, { rows: ROWS }));
    expect(cards).toContain("min-h-11");
    expect(cards).toContain("grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4");
  });
  it("filters and search apply to both views (one filtered list feeds either view), and the footer note stays", () => {
    const src = readFileSync(new URL("./coach-clients-list.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain('view === "cards" ? <ClientsCardView rows={shown} /> : <ClientsListView rows={shown} />');
    expect(src).toContain("The number is how many sessions are left to schedule.");
    const page = readFileSync(new URL("../../../app/(coach)/clients/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("<AddClientButton");
  });
});

describe("remembering the choice", () => {
  const fake = (initial: Record<string, string> = {}) => {
    const store = { ...initial };
    return { store, getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => void (store[k] = v) };
  };
  it("defaults to cards when nothing is saved or the saved value is not a view", () => {
    expect(readClientsView(fake())).toBe("cards");
    expect(readClientsView(fake({ [CLIENTS_VIEW_KEY]: "grid" }))).toBe("cards");
    expect(readClientsView(null)).toBe("cards");
  });
  it("remembers a choice and reads it back", () => {
    const s = fake();
    writeClientsView(s, "list");
    expect(s.store[CLIENTS_VIEW_KEY]).toBe("list");
    expect(readClientsView(s)).toBe("list");
    writeClientsView(s, "cards");
    expect(readClientsView(s)).toBe("cards");
  });
  it("blocked storage never breaks the page: reads fall back to cards and writes are ignored", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readClientsView(broken)).toBe("cards");
    expect(() => writeClientsView(broken, "list")).not.toThrow();
  });
  it("the page reads the saved choice only after it is on screen, so the server and browser first agree", () => {
    const src = readFileSync(new URL("./coach-clients-list.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("useEffect(() => {\n    setView(readClientsView(");
  });
});
