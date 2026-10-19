import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { WithdrawRequestButton } from "@/components/athlete/withdraw-request-button";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: a client could not take back a pending request, and a few stale ones locked them out of asking again.
describe("withdrawing a request that is still waiting", () => {
  it("is a Withdraw button using the client's own database function", () => {
    expect(renderToStaticMarkup(createElement(WithdrawRequestButton, { requestId: "r1" }))).toContain("Withdraw");
    const src = read("components/athlete/withdraw-request-button.tsx");
    expect(src).toContain('rpc("cancel_booking_request", { p_request_id: requestId })');
    expect(src).toContain("Your coach already answered this one.");
  });
  it("sits beside 'Requested. Waiting for your coach.' on both client day pages, and on requests asked for at another time", () => {
    for (const f of ["app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      const src = read(f);
      expect(src, f).toContain('.select("id, new_start_at, new_end_at")');
      expect(src, f).toContain("requestIdByTime.set(t0, r.id as string);");
      expect(src, f).toContain("<WithdrawRequestButton requestId={requestIdByTime.get(start.getTime())!} />");
      expect(src, f).toContain("<WithdrawRequestButton requestId={r.id} />");
    }
  });
});
