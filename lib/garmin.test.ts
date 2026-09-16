import { describe, it, expect } from "vitest";
import { parseGarminWebhookPayload } from "./garmin";

describe("parseGarminWebhookPayload", () => {
  it("parses a real-shaped dailies batch into steps + resting_heart_rate rows", () => {
    const rows = parseGarminWebhookPayload({
      dailies: [
        {
          userAccessToken: "token-abc",
          startTimeInSeconds: 1735689600, // 2025-01-01T00:00:00Z
          startTimeOffsetInSeconds: 0,
          steps: 8500,
          restingHeartRateInBeatsPerMinute: 58,
        },
      ],
    });
    expect(rows).toEqual([
      { externalUserId: "token-abc", date: "2025-01-01", metricType: "steps", value: 8500 },
      { externalUserId: "token-abc", date: "2025-01-01", metricType: "resting_heart_rate", value: 58 },
    ]);
  });

  it("prefers userId over userAccessToken when both are present", () => {
    const rows = parseGarminWebhookPayload({
      dailies: [{ userId: "user-1", userAccessToken: "token-1", startTimeInSeconds: 1735689600, steps: 100 }],
    });
    expect(rows[0].externalUserId).toBe("user-1");
  });

  it("parses a sleeps batch using overallSleepScore.value", () => {
    const rows = parseGarminWebhookPayload({
      sleeps: [
        {
          userAccessToken: "token-abc",
          calendarDate: "2025-01-02",
          overallSleepScore: { value: 82 },
        },
      ],
    });
    expect(rows).toEqual([
      { externalUserId: "token-abc", date: "2025-01-02", metricType: "sleep_score", value: 82 },
    ]);
  });

  it("skips a dailies entry with no user identifier", () => {
    const rows = parseGarminWebhookPayload({
      dailies: [{ startTimeInSeconds: 1735689600, steps: 100 }],
    });
    expect(rows).toEqual([]);
  });

  it("skips a sleeps entry with no usable date", () => {
    const rows = parseGarminWebhookPayload({
      sleeps: [{ userAccessToken: "token-abc", overallSleepScore: { value: 82 } }],
    });
    expect(rows).toEqual([]);
  });

  it("skips a dailies entry with neither steps nor resting heart rate present", () => {
    const rows = parseGarminWebhookPayload({
      dailies: [{ userAccessToken: "token-abc", startTimeInSeconds: 1735689600 }],
    });
    expect(rows).toEqual([]);
  });

  it("handles a genuinely empty or malformed body without throwing", () => {
    expect(parseGarminWebhookPayload(null)).toEqual([]);
    expect(parseGarminWebhookPayload(undefined)).toEqual([]);
    expect(parseGarminWebhookPayload("not an object")).toEqual([]);
    expect(parseGarminWebhookPayload({})).toEqual([]);
    expect(parseGarminWebhookPayload({ dailies: "not an array" })).toEqual([]);
  });

  it("parses multiple users' entries in one batch independently", () => {
    const rows = parseGarminWebhookPayload({
      dailies: [
        { userAccessToken: "token-a", startTimeInSeconds: 1735689600, steps: 100 },
        { userAccessToken: "token-b", startTimeInSeconds: 1735689600, steps: 200 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.externalUserId)).toEqual(["token-a", "token-b"]);
  });
});
