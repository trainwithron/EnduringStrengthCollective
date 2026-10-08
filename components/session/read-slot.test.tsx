import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ from: () => ({ upsert: () => Promise.resolve({ error: null }) }) }),
}));

import { ReadSlot } from "@/components/session/read-slot";

function render(noteSeen: boolean) {
  return renderToStaticMarkup(
    <ReadSlot athleteId="a1" reference="Psalm 46:1" text="God is our refuge and strength, a very present help in trouble." noteSeen={noteSeen} onClose={() => {}} onTurnedOff={() => {}} />
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
    expect(html).toContain("A short passage to read while you rest. Turn it off any time.");
    expect(html).toContain("Turn this off");
  });

  it("does not repeat the explanation once it has been seen", () => {
    const html = render(true);
    expect(html).not.toContain("A short passage to read while you rest");
    expect(html).toContain("Turn this off");
  });
});
