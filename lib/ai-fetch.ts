// Reading an answer from one of the slow AI routes. When the platform itself cuts a request off (a function timeout) it sends back a plain-text page, not our JSON, and calling .json() on it
// shows the person a parse error ("Unexpected token 'A', 'An error o'... is not valid JSON"). This reads the body as text first and turns anything that is not JSON into a calm message.

export const AI_TOO_LONG_MESSAGE = "That took too long. Try again, or ask for fewer days at a time.";

export async function readAiJson(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : { error: AI_TOO_LONG_MESSAGE };
  } catch {
    return { error: AI_TOO_LONG_MESSAGE };
  }
}
