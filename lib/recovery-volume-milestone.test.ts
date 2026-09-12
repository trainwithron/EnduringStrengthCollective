import { describe, it, expect } from "vitest";
import { computeRecoveryVolumeMilestone } from "./recovery-volume-milestone";

describe("computeRecoveryVolumeMilestone", () => {
  const asOf = new Date("2026-09-12T00:00:00");

  function buildRows(startDaysAgo: number, endDaysAgo: number, value: number): { date: string; value: number }[] {
    const rows: { date: string; value: number }[] = [];
    for (let d = startDaysAgo; d >= endDaysAgo; d--) {
      const date = new Date(asOf);
      date.setDate(date.getDate() - d);
      rows.push({ date: date.toISOString().slice(0, 10), value });
    }
    return rows;
  }

  it("qualifies when readiness holds steady and volume rises meaningfully", () => {
    // 4-week window = 28 days. First half: readiness logged daily at 3.5,
    // 3 training days at 8000 lbs. Second half: readiness still 3.5,
    // volume up to 9000 (12.5%, above the 10% floor).
    const readinessRows = [...buildRows(27, 14, 3.5), ...buildRows(13, 0, 3.5)];
    const volumeRows = [
      ...buildRows(27, 21, 8000).filter((_, i) => i % 2 === 0),
      ...buildRows(13, 7, 9000).filter((_, i) => i % 2 === 0),
    ];
    const result = computeRecoveryVolumeMilestone(readinessRows, volumeRows, asOf);
    expect(result).not.toBeNull();
    expect(result!.qualifies).toBe(true);
  });

  it("does not qualify when volume didn't meaningfully increase", () => {
    const readinessRows = [...buildRows(27, 14, 3.5), ...buildRows(13, 0, 3.6)];
    const volumeRows = [
      ...buildRows(27, 21, 8000).filter((_, i) => i % 2 === 0),
      ...buildRows(13, 7, 8100).filter((_, i) => i % 2 === 0), // +1.25%, below floor
    ];
    const result = computeRecoveryVolumeMilestone(readinessRows, volumeRows, asOf);
    expect(result).not.toBeNull();
    expect(result!.qualifies).toBe(false);
  });

  it("does not qualify when readiness meaningfully declined even with more volume", () => {
    const readinessRows = [...buildRows(27, 14, 4).map((r) => r), ...buildRows(13, 0, 3)]; // -25%
    const volumeRows = [
      ...buildRows(27, 21, 8000).filter((_, i) => i % 2 === 0),
      ...buildRows(13, 7, 9500).filter((_, i) => i % 2 === 0),
    ];
    const result = computeRecoveryVolumeMilestone(readinessRows, volumeRows, asOf);
    expect(result).not.toBeNull();
    expect(result!.qualifies).toBe(false);
  });

  it("returns null when there isn't enough data to judge", () => {
    const readinessRows = [{ date: "2026-09-10", value: 3.5 }];
    const volumeRows = [{ date: "2026-09-10", value: 8000 }];
    expect(computeRecoveryVolumeMilestone(readinessRows, volumeRows, asOf)).toBeNull();
  });
});
