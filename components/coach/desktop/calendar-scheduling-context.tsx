"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { DraggedClient } from "./draggable-client-name";

// The client the coach has picked on the calendar page (by tapping a name, or by dropping one on a day): the rail and the grid sit in different columns, so
// they share it here. On a touch screen this is the whole interaction: tap a client, tap a day, tap a time.
interface CalendarScheduling {
  client: DraggedClient | null;
  setClient: (c: DraggedClient | null) => void;
}

const Ctx = createContext<CalendarScheduling>({ client: null, setClient: () => {} });

export function CalendarSchedulingProvider({ initialClient, children }: { initialClient?: DraggedClient | null; children: React.ReactNode }) {
  const [client, setClient] = useState<DraggedClient | null>(initialClient ?? null);
  const value = useMemo(() => ({ client, setClient }), [client]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCalendarScheduling(): CalendarScheduling {
  return useContext(Ctx);
}
