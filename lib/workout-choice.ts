// The workout screen's one choice (complete it, pause it, or keep going) is opened by the Complete workout button, by the on-screen Back, and by the phone's back gesture. Back is a separate
// component, so it asks for the choice with this event.
export const WORKOUT_CHOICE_EVENT = "workout:choose";

export function askWorkoutChoice(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKOUT_CHOICE_EVENT));
}
