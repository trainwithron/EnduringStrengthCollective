// A client's health screening ANSWERS are read through the database's health_answers() functions (migration 0399), never straight from the client_intake table: they answer only for the client, a coach of the
// client's CURRENT groups, and an owner or admin the organization's owner has granted. The result says which of three things happened, so a failed read is never taken for "no concerns":
//   ok    the answers (possibly an empty list)
//   none  the database answered and gave nothing: there is no form, or this viewer may not read it (a caller that can see the form row knows which)
//   error the read itself failed; the caller must say so and must not carry on as if there were nothing to worry about
export interface HealthAnswer {
  question: string;
  answer: boolean;
}

export type HealthRead = { kind: "ok"; answers: HealthAnswer[] } | { kind: "none" } | { kind: "error" };

// Works with a server or a browser client.
export async function readHealthAnswers(client: any, athleteId: string): Promise<HealthRead> {
  try {
    const { data, error } = await client.rpc("health_answers", { p_athlete: athleteId });
    if (error) return { kind: "error" };
    return Array.isArray(data) ? { kind: "ok", answers: data as HealthAnswer[] } : { kind: "none" };
  } catch {
    return { kind: "error" };
  }
}

export const HEALTH_READ_FAILED_MESSAGE = "Couldn't read this client's health screening just now, so nothing was done. Try again in a moment.";

export async function readHealthAnswersMany(client: any, athleteIds: string[]): Promise<{ answers: Map<string, HealthAnswer[]>; failed: boolean }> {
  try {
    const { data, error } = await client.rpc("health_answers_many", { p_athletes: athleteIds });
    if (error) return { answers: new Map(), failed: true };
    return { answers: new Map(((data ?? []) as { athlete_id: string; par_q_answers: HealthAnswer[] | null }[]).map((r) => [r.athlete_id, Array.isArray(r.par_q_answers) ? r.par_q_answers : []])), failed: false };
  } catch {
    return { answers: new Map(), failed: true };
  }
}
