"use client";

import { createContext, useContext } from "react";
import type { WeightUnit } from "@/lib/units";

// The unit the person whose workout this is chose for lifted weights (pounds unless they picked kilograms). Anything on the workout screens that shows or takes a weight reads it from here.
const Ctx = createContext<WeightUnit>("lb");

export function LiftUnitProvider({ unit, children }: { unit: WeightUnit; children: React.ReactNode }) {
  return <Ctx.Provider value={unit}>{children}</Ctx.Provider>;
}

export function useLiftUnit(): WeightUnit {
  return useContext(Ctx);
}
