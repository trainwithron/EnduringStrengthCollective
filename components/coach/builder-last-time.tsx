"use client";

import { createContext, useContext } from "react";

// What the client did last time on each exercise, for the builder cards of a client's own program (Ron, Nov 20: B6). Given once by the program page; a card outside it (a group program, a
// template) finds nothing and shows no line.
const LastTimeContext = createContext<Record<string, { weight: number; reps: number }>>({});

export function BuilderLastTimeProvider({ value, children }: { value: Record<string, { weight: number; reps: number }>; children: React.ReactNode }) {
  return <LastTimeContext.Provider value={value}>{children}</LastTimeContext.Provider>;
}

export function useBuilderLastTime(exerciseName: string): { weight: number; reps: number } | null {
  return useContext(LastTimeContext)[exerciseName] ?? null;
}
