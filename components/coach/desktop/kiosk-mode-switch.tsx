"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export type KioskMode = "group" | "front_desk";

// "Who checks in on this tablet?" (Ron, Nov 2: "are you using this for a specific group, or is this gonna be like your front desk check-in type of deal?"). Saved on the group;
// the page then opens that screen and lists those people.
export function KioskModeSwitch({ groupId, groupName, orgName, initialMode }: { groupId: string; groupName: string; orgName: string; initialMode: KioskMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<KioskMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(next: KioskMode) {
    if (next === mode || busy) return;
    setBusy(true);
    setError(null);
    const { error: saveError } = await createBrowserClient().rpc("set_kiosk_mode", { p_group: groupId, p_mode: next });
    setBusy(false);
    if (saveError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setMode(next);
    router.refresh();
  }

  const options: { value: KioskMode; title: string; body: string }[] = [
    { value: "group", title: "One group or class", body: `A team practice or a class. People tap their name from ${groupName}'s list.` },
    { value: "front_desk", title: "Everyone (front desk)", body: `Every client in ${orgName.replace(/\.+$/, "")}. They scan their card or type their name. Works at the door even with nobody at the desk.` },
  ];
  return (
    <section className="mb-8" aria-labelledby="kiosk-mode-title">
      <h2 id="kiosk-mode-title" className="font-display uppercase text-sm tracking-wide text-chalk mb-3">
        Who checks in on this tablet?
      </h2>
      <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-2.5" role="radiogroup" aria-labelledby="kiosk-mode-title">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={mode === o.value}
            onClick={() => pick(o.value)}
            disabled={busy}
            className={`text-left border p-4 flex flex-col gap-1 disabled:opacity-60 ${mode === o.value ? "border-rust bg-rust/10" : "border-steel/25 hover:border-steel/50"}`}
          >
            <span className={`font-display uppercase text-base leading-tight ${mode === o.value ? "text-rust" : "text-chalk"}`}>{o.title}</span>
            <span className="font-body text-xs text-steel leading-snug">{o.body}</span>
          </button>
        ))}
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
