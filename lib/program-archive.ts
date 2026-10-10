// "Remove from this profile": the wording the coach confirms. Nothing is deleted - the copy, its workouts and every log stay - so the message says so plainly.
export function removeProgramMessage(programName: string, clientName: string): string {
  const who = clientName.trim() || "this client";
  return `Remove "${programName}" from ${who}'s profile? Their logged history stays. You can put it back any time.`;
}
