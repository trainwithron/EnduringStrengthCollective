"use client";

import { createContext, useContext } from "react";
import type { DemoRow } from "@/lib/exercise-demo";

// The coach's exercise library (name and demo links only) and the way to open an exercise's demo, given to the logger once: so an exercise added or swapped
// mid-workout finds its demo from its current name the same way the prescribed ones do, and one sheet (with Previous / Next) serves every card.
// Null outside the logger.
export interface DemoBrowser {
  library: DemoRow[];
  openDemo: (exerciseId: string) => void;
}

const DemoLibraryContext = createContext<DemoBrowser | null>(null);

export const DemoLibraryProvider = DemoLibraryContext.Provider;

export function useDemoLibrary(): DemoRow[] | null {
  return useContext(DemoLibraryContext)?.library ?? null;
}

export function useOpenDemo(): ((exerciseId: string) => void) | null {
  return useContext(DemoLibraryContext)?.openDemo ?? null;
}
