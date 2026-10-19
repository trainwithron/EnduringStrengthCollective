// When a logged set counts as done (Ron, Sep 12: "The big ones are weights and reps are the two nonnegotiables that have to be there. Outside of that, everything else should be optional ... we need to be able to leave
// certain fields blank."). Weight and reps are the only fields that ever block: a bodyweight movement needs reps alone, and RPE, RIR, tempo, time, height, distance, pace and rest never block anything. An exercise that
// tracks neither weight nor reps (a timed hold, a distance run) is done once any one of its fields has a value.
export interface SetValues {
  weight?: unknown;
  reps?: unknown;
  [prop: string]: unknown;
}

function has(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

export function isSetFilled(set: SetValues, trackedProps: string[], weightOptional: boolean): boolean {
  const tracksWeight = trackedProps.includes("weight") && !weightOptional;
  const tracksReps = trackedProps.includes("reps");
  if (tracksWeight || tracksReps) return (!tracksWeight || has(set.weight)) && (!tracksReps || has(set.reps));
  return trackedProps.some((p) => has(set[p]));
}
