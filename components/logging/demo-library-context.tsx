"use client";

import { createContext, useContext } from "react";
import type { DemoRow } from "@/lib/exercise-demo";

// The coach's exercise library (name and demo links only), given to the logger once so an exercise added or swapped mid-workout finds its demo from its
// current name the same way the prescribed ones do. Null outside the logger.
const DemoLibraryContext = createContext<DemoRow[] | null>(null);

export const DemoLibraryProvider = DemoLibraryContext.Provider;

export function useDemoLibrary(): DemoRow[] | null {
  return useContext(DemoLibraryContext);
}
