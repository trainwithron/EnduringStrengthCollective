// Put a client on hold or take them off, from the browser: the one server call every hold control uses (app/api/reup/hold), so Needs payment, the group's client cards, the Clients menu and
// the client's Billing all do the same thing.
export async function setPaymentHold(groupId: string, athleteId: string, hold: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/reup/hold", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, athleteId, hold }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? "That didn't work. Try again." };
    return { ok: true };
  } catch {
    return { ok: false, error: "That didn't work. Check your connection and try again." };
  }
}

// What Needs payment says a hold is and where it comes off.
export const HOLD_UNDO_WHERE = "You can take a hold off from the client's menu (the three dots) on the Clients page, or in Billing on their profile.";
