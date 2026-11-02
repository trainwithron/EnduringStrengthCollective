"use client";

import { useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { generateKioskPin } from "@/lib/kiosk-pin";
import { normalizeCardCode } from "@/lib/checkin-cards";

export interface KioskRosterEntry {
  athleteId: string;
  // The group the PIN belongs to (a PIN is per group; in front-desk mode each client is listed in their own group).
  groupId: string;
  groupName?: string;
  fullName: string;
  hasPin: boolean;
  // A key card is per client in the organization (step 198).
  hasCard?: boolean;
}

// hidden_by_default_config_design_principle.md — a PIN is a code every
// other athlete on the roster could in principle see over a coach's
// shoulder, so it stays masked until this specific row is tapped open,
// same "don't show it unless asked" discipline as every other
// reveal-on-demand control in this app.
// With an organization, each row also links the client's key card: press Link card, scan the card (or type its number) and press Enter.
export function KioskPinManager({ initialRoster, organizationId = null, showGroup = false }: { initialRoster: KioskRosterEntry[]; organizationId?: string | null; showGroup?: boolean }) {
  const [roster, setRoster] = useState(initialRoster);
  // A PIN is stored hashed and cannot be read back. The one you generate is shown here until you leave the page, so
  // you can tell the athlete; after that only "PIN set" shows and Reset makes a new one.
  const [justSet, setJustSet] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [cardInput, setCardInput] = useState("");
  const [filter, setFilter] = useState("");
  const rowKey = (r: KioskRosterEntry) => `${r.groupId}:${r.athleteId}`;

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? roster.filter((r) => r.fullName.toLowerCase().includes(q)) : roster;
  }, [roster, filter]);

  async function resetPin(r: KioskRosterEntry) {
    const key = rowKey(r);
    setBusyKey(key);
    const newPin = generateKioskPin();
    const supabase = createBrowserClient();
    setError(null);
    let { error: saveError } = await supabase.rpc("set_kiosk_pin", { p_group_id: r.groupId, p_athlete_id: r.athleteId, p_pin: newPin });
    if (saveError && /could not find the function|does not exist/i.test(saveError.message)) {
      // Hashed PINs are not on this database yet: the older plain column still works.
      ({ error: saveError } = await supabase
        .from("group_memberships")
        .update({ kiosk_pin: newPin })
        .eq("group_id", r.groupId)
        .eq("profile_id", r.athleteId));
    }
    if (saveError) {
      setError("Couldn't save that PIN. Try again.");
    } else {
      setRoster((prev) => prev.map((x) => (rowKey(x) === key ? { ...x, hasPin: true } : x)));
      setJustSet((prev) => ({ ...prev, [key]: newPin }));
    }
    setBusyKey(null);
  }

  async function saveCard(r: KioskRosterEntry, raw: string | null) {
    if (!organizationId) return;
    const code = raw === null ? null : normalizeCardCode(raw);
    if (raw !== null && !code) {
      setError("That isn't a card number. Scan the card again, or type the number on it.");
      return;
    }
    setBusyKey(rowKey(r));
    setError(null);
    const { data, error: saveError } = await createBrowserClient().rpc("set_checkin_card", { p_org: organizationId, p_athlete: r.athleteId, p_code: code ?? "" });
    setBusyKey(null);
    if (saveError) {
      setError("Couldn't save that card. Try again.");
      return;
    }
    if (data === "taken") {
      setError("That card is already linked to another client.");
      return;
    }
    // A card belongs to the client, so every row of theirs shows it.
    setRoster((prev) => prev.map((x) => (x.athleteId === r.athleteId ? { ...x, hasCard: code !== null } : x)));
    setLinkingKey(null);
    setCardInput("");
  }

  return (
    <div>
      {roster.length > 8 && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a client…"
          aria-label="Find a client"
          className="w-full max-w-xs h-9 mb-3 bg-surface border border-steel/30 px-2.5 font-body text-sm text-chalk focus:outline-none focus:border-rust"
        />
      )}
      {error && (
        <p className="font-body text-xs text-rust mb-2" role="alert">
          {error}
        </p>
      )}
      <div className="divide-y divide-steel/15 border border-steel/20">
        {shown.map((r) => {
          const key = rowKey(r);
          return (
            <div key={key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
              <span className="font-body text-sm min-w-0">
                {r.fullName}
                {showGroup && r.groupName && r.groupName !== r.fullName && <span className="block font-body text-xs text-steel">{r.groupName}</span>}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                {organizationId &&
                  (linkingKey === key ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveCard(r, cardInput);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        autoFocus
                        value={cardInput}
                        onChange={(e) => setCardInput(e.target.value)}
                        placeholder="Scan the card or type its number"
                        aria-label={`Card number for ${r.fullName}`}
                        className="h-8 w-56 bg-surface border border-rust px-2 font-body text-xs text-chalk focus:outline-none"
                      />
                      <button type="submit" disabled={busyKey === key} className="h-8 px-3 bg-rust text-graphite font-body text-xs disabled:opacity-40">
                        Save
                      </button>
                      <button type="button" onClick={() => setLinkingKey(null)} className="h-8 px-2 font-body text-xs text-steel">
                        Cancel
                      </button>
                    </form>
                  ) : r.hasCard ? (
                    <span className="flex items-center gap-2">
                      <span className="font-body text-xs text-positive">Card linked</span>
                      <button type="button" onClick={() => void saveCard(r, null)} disabled={busyKey === key} className="font-body text-xs text-steel underline underline-offset-2 disabled:opacity-40">
                        Remove
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setCardInput("");
                        setLinkingKey(key);
                      }}
                      className="h-8 px-3 border border-steel/30 font-body text-xs text-chalk"
                    >
                      Link card
                    </button>
                  ))}
                {justSet[key] ? (
                  <span className="font-display text-sm tracking-[0.2em] text-chalk w-16 text-center">{justSet[key]}</span>
                ) : r.hasPin ? (
                  <span className="font-body text-xs text-steel">PIN set</span>
                ) : (
                  <span className="font-body text-xs text-steel">No PIN set</span>
                )}
                <button
                  type="button"
                  onClick={() => resetPin(r)}
                  disabled={busyKey === key}
                  className="h-8 px-3 bg-surface border border-steel/30 font-body text-xs text-chalk disabled:opacity-40"
                >
                  {busyKey === key ? "…" : r.hasPin ? "Reset PIN" : "Make PIN"}
                </button>
              </div>
            </div>
          );
        })}
        {roster.length === 0 && <p className="font-body text-sm text-steel px-4 py-6 text-center">No athletes in this group yet.</p>}
        {roster.length > 0 && shown.length === 0 && <p className="font-body text-sm text-steel px-4 py-6 text-center">No one by that name.</p>}
      </div>
    </div>
  );
}
