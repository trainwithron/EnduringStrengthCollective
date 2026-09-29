"use client";

import { createContext, useContext } from "react";
import { flashSaved, flashSaveError, subscribeSaveToast, type SaveToastChannel } from "@/lib/save-toast";

const defaultChannel: SaveToastChannel = { flashSaved, flashSaveError, subscribeSaveToast };

// Exported raw so a component that OWNS a channel (creates it via
// createSaveToastChannel(), e.g. ProgramBuilderDesktop) can provide that
// exact instance directly with <SaveToastChannelContext.Provider>,
// keeping its own top-level save calls (rename, add-week) and its
// descendants' calls (day-card, exercise rows, etc.) on the same bus —
// see lib/save-toast.ts's createSaveToastChannel doc comment for why
// this scoping exists at all.
export const SaveToastChannelContext = createContext<SaveToastChannel>(defaultChannel);

// Falls back to the shared default channel for anything rendered outside
// a SaveToastChannelContext.Provider — preserves today's behavior for
// every existing call site until it's deliberately moved inside the
// Program Builder's own provider.
export function useSaveToastChannel(): SaveToastChannel {
  return useContext(SaveToastChannelContext);
}
