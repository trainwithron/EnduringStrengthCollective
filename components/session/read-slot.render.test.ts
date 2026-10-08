import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ from: () => ({ upsert: () => Promise.resolve({ error: null }) }) }),
}));

import { ReadSlot } from "@/components/session/read-slot";

function render(noteSeen: boolean) {
  return renderToStaticMarkup(
    createElement(ReadSlot, { athleteId: "a1", reference: "Psalm 46:1", text: "God is our refuge and strength, a very present help in trouble.", noteSeen, onClose: () => {}, onTurnedOff: () => {} })
  );
}

describe("ReadSlot", () => {
  it("shows the passage and its reference", () => {
    const html = render(true);
    expect(html).toContain("God is our refuge and strength");
    expect(html).toContain("Psalm 46:1 (KJV)");
  });

  it("explains itself the first time, with a way to turn it off", () => {
    const html = render(false);
    expect(html).toContain("A short Bible passage (King James) to read while you rest. Turn it off any time.");
    expect(html).toContain("Turn this off");
  });

  it("keeps every control at least 44px tall", () => {
    const html = render(false);
    expect(html).not.toContain("h-9");
    expect((html.match(/min-h-\[44px\]/g) ?? []).length).toBe(3);
  });

  it("does not repeat the explanation once it has been seen", () => {
    const html = render(true);
    expect(html).not.toContain("to read while you rest. Turn it off");
    expect(html).toContain("Turn this off");
  });
});
