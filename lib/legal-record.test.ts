import { describe, expect, it, vi } from "vitest";
import { recordLegalAcceptances } from "./legal-record";
import { LEGAL_VERSIONS, SIGNUP_DOCUMENTS } from "./legal";

function fakeClient(error: { message: string } | null = null) {
  const upsert = vi.fn(async () => ({ error }));
  return { client: { from: vi.fn(() => ({ upsert })) } as never, upsert };
}

describe("recordLegalAcceptances", () => {
  it("records each document with its current version, address and device", async () => {
    const { client, upsert } = fakeClient();
    const ok = await recordLegalAcceptances(client, {
      profileId: "p1",
      documents: SIGNUP_DOCUMENTS,
      ip: "203.0.113.5",
      userAgent: "TestAgent/1.0",
    });
    expect(ok).toBe(true);
    const rows = (upsert.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
    expect(rows.map((r) => r.document)).toEqual(SIGNUP_DOCUMENTS);
    expect(rows[0]).toMatchObject({ profile_id: "p1", version: LEGAL_VERSIONS.beta_notice, ip: "203.0.113.5", user_agent: "TestAgent/1.0" });
  });

  it("keeps the exact waiver text with the acceptance", async () => {
    const { client, upsert } = fakeClient();
    await recordLegalAcceptances(client, { profileId: "p1", documents: ["waiver"], ip: null, userAgent: null, snapshots: { waiver: "I agree to ..." } });
    const rows = (upsert.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
    expect(rows[0].text_snapshot).toBe("I agree to ...");
  });

  it("reports false instead of throwing when the table is not there yet", async () => {
    const { client } = fakeClient({ message: "relation does not exist" });
    expect(await recordLegalAcceptances(client, { profileId: "p1", documents: ["terms"], ip: null, userAgent: null })).toBe(false);
  });
});
