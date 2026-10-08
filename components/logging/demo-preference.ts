"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// A client who does not want exercise demos can turn them off in Settings (Ron, Oct 6: not forced on everyone). The choice belongs to the PERSON: it is saved in their account
// (client_ui_settings, only they can read or change it) so it follows them to every phone and computer. The browser also keeps a copy, so the screen is right at once, before the
// account answers, and when storage or the network is unavailable demos simply stay as they were. A person who never used the switch has no account row yet: their old
// on-this-device choice stays in force and is saved to the account the first time the page loads or they flip the switch.
const KEY = "demos-hidden";
const EVENT = "demos-hidden-changed";

function readLocal(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writeLocal(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // nothing to do: the choice just is not remembered on this device
  }
}

export function readDemosHidden(): boolean {
  return readLocal();
}

// Saves to the account. Resolves false when it could not be saved (not signed in, offline, or the database does not have the table yet): the device copy still applies.
async function saveToAccount(hidden: boolean): Promise<boolean> {
  try {
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase.from("client_ui_settings").upsert({ athlete_id: user.id, hide_demos: hidden, updated_at: new Date().toISOString() }, { onConflict: "athlete_id" });
    return !error;
  } catch {
    return false;
  }
}

// The person's own choice, read once per page load (the first screen to ask starts it, the others share the answer).
let accountLoad: Promise<void> | null = null;
function loadFromAccount(): Promise<void> {
  if (accountLoad) return accountLoad;
  accountLoad = (async () => {
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase.from("client_ui_settings").select("hide_demos").eq("athlete_id", user.id).maybeSingle();
      if (error) return;
      if (data) {
        const fromAccount = !!data.hide_demos;
        if (fromAccount !== readLocal()) {
          writeLocal(fromAccount);
          window.dispatchEvent(new Event(EVENT));
        }
      } else if (readLocal()) {
        // They turned demos off on this device before the choice followed the person: save it to the account now.
        await saveToAccount(true);
      }
    } catch {
      // the device copy keeps working
    }
  })();
  return accountLoad;
}

// Turns demos off or on. Applies at once on this device, then saves to the account; resolves true when the account has it too.
export async function writeDemosHidden(hidden: boolean): Promise<boolean> {
  writeLocal(hidden);
  window.dispatchEvent(new Event(EVENT));
  return saveToAccount(hidden);
}

export function useDemosHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const sync = () => setHidden(readLocal());
    sync();
    void loadFromAccount();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return hidden;
}
