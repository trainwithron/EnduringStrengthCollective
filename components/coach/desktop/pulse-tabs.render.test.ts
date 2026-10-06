import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { PulseTabs } from "./pulse-tabs";

const client = (i: number, quietTier?: "mild" | "strong") => ({
  groupId: `g${i}`,
  athleteId: `a${i}`,
  fullName: `Client Number${i}`,
  avatarUrl: null,
  lastWorkoutAt: null,
  hasUnseenActivity: false,
  quietTier,
});

const render = (clients: ReturnType<typeof client>[]) =>
  renderToStaticMarkup(createElement(PulseTabs, { clientCards: clients, teamPulses: [], teamCards: [], socialCards: [] }));

describe("Client Pulse on Home", () => {
  it("collapses a long attention list to a count, and the names stay out of the way until it is opened", () => {
    const clients = Array.from({ length: 12 }, (_, i) => client(i, i < 8 ? "strong" : undefined));
    const html = render(clients);
    expect(html).toContain("8 need attention");
    // the attention list itself is closed: no per-client snooze buttons are on the page yet
    expect(html).not.toContain("Snooze 7 days");
    expect(html).not.toContain("Clear all for 7 days");
    // and with this many clients the full client grid is collapsed too
    expect(html).not.toContain("Client Number11");
  });
  it("says 'needs' for one client and shows nothing when no one is flagged", () => {
    expect(render([client(1, "mild"), client(2)])).toContain("1 needs attention");
    expect(render([client(1), client(2)])).not.toContain("attention");
  });
  it("keeps a small roster fully visible", () => {
    expect(render([client(1), client(2)])).toContain("Client Number1");
  });
});
