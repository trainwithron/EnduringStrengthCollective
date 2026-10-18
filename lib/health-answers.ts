// A client's health screening ANSWERS are read through the database's health_answers() functions (migration 0399), never straight from the client_intake table: they answer only for the client, a coach of the
// client's group, and an owner or admin the organization's owner has granted. Everyone else gets null (the form can still be seen as done or not through the table's other columns).
export interface HealthAnswer {
  question: string;
  answer: boolean;
}

// Works with a server or a browser client. null = not allowed to read (or no form on file); a list (possibly empty) = readable.
export async function readHealthAnswers(client: any, athleteId: string): Promise<HealthAnswer[] | null> {
  const { data, error } = await client.rpc("health_answers", { p_athlete: athleteId });
  if (error || !Array.isArray(data)) return null;
  return data as HealthAnswer[];
}

export async function readHealthAnswersMany(client: any, athleteIds: string[]): Promise<{ answers: Map<string, HealthAnswer[]>; failed: boolean }> {
  const { data, error } = await client.rpc("health_answers_many", { p_athletes: athleteIds });
  if (error) return { answers: new Map(), failed: true };
  return { answers: new Map(((data ?? []) as { athlete_id: string; par_q_answers: HealthAnswer[] | null }[]).map((r) => [r.athlete_id, Array.isArray(r.par_q_answers) ? r.par_q_answers : []])), failed: false };
}
