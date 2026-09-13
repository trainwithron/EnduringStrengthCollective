import { describe, it, expect } from "vitest";
import { validateNoUnresolvedAthleteNames } from "./coach-chat-name-guard";

describe("validateNoUnresolvedAthleteNames", () => {
  it("passes when the answer only mentions resolved athletes", () => {
    const result = validateNoUnresolvedAthleteNames(
      "Alice Athlete logged a workout yesterday.",
      ["Alice Athlete"],
      ["Alice Athlete", "Ben Athlete", "Carla"]
    );
    expect(result.valid).toBe(true);
    expect(result.violatingNames).toEqual([]);
  });

  it("flags an unresolved roster name volunteered into the answer", () => {
    const result = validateNoUnresolvedAthleteNames(
      "Alice Athlete is doing well. Ben Athlete has been quiet lately too.",
      ["Alice Athlete"],
      ["Alice Athlete", "Ben Athlete", "Carla"]
    );
    expect(result.valid).toBe(false);
    expect(result.violatingNames).toEqual(["Ben Athlete"]);
  });

  it("allows naming two clients the coach both asked about", () => {
    const result = validateNoUnresolvedAthleteNames(
      "Alice Athlete and Ben Athlete both logged workouts this week.",
      ["Alice Athlete", "Ben Athlete"],
      ["Alice Athlete", "Ben Athlete", "Carla"]
    );
    expect(result.valid).toBe(true);
  });

  it("is case-insensitive on both the resolved set and the roster scan", () => {
    const result = validateNoUnresolvedAthleteNames(
      "alice athlete logged a workout.",
      ["Alice Athlete"],
      ["Alice Athlete", "Ben Athlete"]
    );
    expect(result.valid).toBe(true);
  });

  it("never flags a name that isn't on the roster at all", () => {
    const result = validateNoUnresolvedAthleteNames(
      "A generic strength principle applies here.",
      [],
      ["Alice Athlete", "Ben Athlete"]
    );
    expect(result.valid).toBe(true);
  });
});
