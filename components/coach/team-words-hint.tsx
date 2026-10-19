"use client";

import { createContext, useContext } from "react";
import { NO_TEAM_WORDS_HINT, type TeamWordsHint } from "@/lib/team-sport";

// What the server knew about the workspace when it drew the page (see lib/team-words-server.ts): the terminology provider starts its words from it.
const TeamWordsHintContext = createContext<TeamWordsHint>(NO_TEAM_WORDS_HINT);

export function TeamWordsHintProvider({ hint, children }: { hint: TeamWordsHint; children: React.ReactNode }) {
  return <TeamWordsHintContext.Provider value={hint}>{children}</TeamWordsHintContext.Provider>;
}

export const useTeamWordsHint = (): TeamWordsHint => useContext(TeamWordsHintContext);
