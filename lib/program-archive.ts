// "Remove from this profile": the wording the coach confirms. Nothing is deleted - the copy, its workouts and every log stay - so the message says so plainly.
export function removeOwnProgramMessage(programName: string): string {
  return `Remove "${programName}" from your list? Your workout history stays.`;
}

export function hideProgramMessage(programName: string): string {
  return `Hide "${programName}" from your library? Nothing is deleted, and you can put it back from Hidden programs.`;
}

export function removeProgramMessage(programName: string, clientName: string): string {
  const who = clientName.trim() || "this client";
  return `Remove "${programName}" from ${who}'s profile? Their logged history stays. You can put it back any time.`;
}
