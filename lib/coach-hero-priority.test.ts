import { describe, expect, it } from "vitest";
import { selectHeroFlag, type HeroFlag } from "./coach-hero-priority";

function flag(overrides: Partial<HeroFlag> & Pick<HeroFlag, "kind">): HeroFlag {
  return {
    athleteId: "a1",
    athleteName: "Alex",
    groupId: "g1",
    groupName: "Group",
    ...(overrides as any),
  };
}

describe("selectHeroFlag", () => {
  it("returns null when there are no flags", () => {
    expect(selectHeroFlag([])).toBeNull();
  });

  it("picks low_readiness over quiet_client and missed_habits", () => {
    const flags: HeroFlag[] = [
      flag({ kind: "missed_habits", missedCount: 5 } as any),
      flag({ kind: "quiet_client", tier: "strong" } as any),
      flag({ kind: "low_readiness", readiness: 1.5 } as any),
    ];
    expect(selectHeroFlag(flags)?.kind).toBe("low_readiness");
  });

  it("picks low_readiness over matched_load_trend", () => {
    const flags: HeroFlag[] = [
      flag({ kind: "matched_load_trend", direction: "fatigue", exerciseName: "Back Squat", sessionCount: 3 } as any),
      flag({ kind: "low_readiness", readiness: 1.5 } as any),
    ];
    expect(selectHeroFlag(flags)?.kind).toBe("low_readiness");
  });

  it("picks matched_load_trend over quiet_client and missed_habits", () => {
    const flags: HeroFlag[] = [
      flag({ kind: "missed_habits", missedCount: 5 } as any),
      flag({ kind: "quiet_client", tier: "strong" } as any),
      flag({ kind: "matched_load_trend", direction: "fatigue", exerciseName: "Back Squat", sessionCount: 3 } as any),
    ];
    expect(selectHeroFlag(flags)?.kind).toBe("matched_load_trend");
  });

  it("picks quiet_client over missed_habits", () => {
    const flags: HeroFlag[] = [
      flag({ kind: "missed_habits", missedCount: 5 } as any),
      flag({ kind: "quiet_client", tier: "mild" } as any),
    ];
    expect(selectHeroFlag(flags)?.kind).toBe("quiet_client");
  });

  it("picks a strong quiet_client tier over a mild one", () => {
    const flags: HeroFlag[] = [
      flag({ kind: "quiet_client", tier: "mild", athleteId: "mild-athlete" } as any),
      flag({ kind: "quiet_client", tier: "strong", athleteId: "strong-athlete" } as any),
    ];
    expect(selectHeroFlag(flags)?.athleteId).toBe("strong-athlete");
  });

  it("falls back to missed_habits when nothing higher-priority exists", () => {
    const flags: HeroFlag[] = [flag({ kind: "missed_habits", missedCount: 3 } as any)];
    expect(selectHeroFlag(flags)?.kind).toBe("missed_habits");
  });
});
