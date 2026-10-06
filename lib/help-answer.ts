// "What do you feel you need the most help with right now?" is sent as an ordinary message from the coach (docs/TIME_TO_PROGRESS_DESIGN.md), and the client's
// answer is an ordinary reply. Nothing new is stored: the question is found in the real conversation (so a draft the coach never sent is never counted), and the
// answer is the client's first message after it.

export const HELP_QUESTION_MARKER = "need the most help with";

export interface ThreadMessage {
  senderId: string;
  body: string;
  createdAt: string;
}

export interface HelpAnswer {
  askedAt: string;
  answer: string | null;
  answeredAt: string | null;
}

export function findHelpAnswer(messages: ThreadMessage[], coachId: string, athleteId: string): HelpAnswer | null {
  const ordered = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let askIndex = -1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i].senderId === coachId && ordered[i].body.toLowerCase().includes(HELP_QUESTION_MARKER)) {
      askIndex = i;
      break;
    }
  }
  if (askIndex < 0) return null;
  const reply = ordered.slice(askIndex + 1).find((m) => m.senderId === athleteId);
  return { askedAt: ordered[askIndex].createdAt, answer: reply?.body ?? null, answeredAt: reply?.createdAt ?? null };
}
