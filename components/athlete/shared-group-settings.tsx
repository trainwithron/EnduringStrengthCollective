"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Settings for a one-on-one client who joined their organization's shared group from Home (Ron, Nov 9): whether their finished workouts also post there, and a way to leave. Both go through
// /api/shared-group, which only ever changes the client's own social-only seat. A client under 18 cannot switch sharing on.
export function SharedGroupSettings({ groupId, groupName, initialShares, allowShare }: { groupId: string; groupName: string; initialShares: boolean; allowShare: boolean }) {
  const router = useRouter();
  const [shares, setShares] = useState(initialShares);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaveAsked, setLeaveAsked] = useState(false);
  const [left, setLeft] = useState(false);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shared-group", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data?.error as string | undefined) ?? "Couldn't save that. Try again.");
        return false;
      }
      return true;
    } catch {
      setError("Couldn't save that. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changeShare(next: boolean) {
    const previous = shares;
    setShares(next);
    if (!(await send({ action: "share", groupId, share: next }))) setShares(previous);
  }

  async function leave() {
    if (await send({ action: "leave", groupId })) {
      setLeft(true);
      router.refresh();
    }
  }

  if (left) return <p className="font-body text-sm text-steel" role="status">You left {groupName}.</p>;

  return (
    <div>
      <label className={`flex items-start gap-3 min-h-11 ${allowShare ? "cursor-pointer" : "opacity-60"}`}>
        <input
          type="checkbox"
          checked={shares}
          disabled={busy || (!allowShare && !shares)}
          onChange={(e) => void changeShare(e.target.checked)}
          className="mt-1 h-5 w-5 accent-rust"
        />
        <span>
          <span className="block font-body text-sm text-chalk">Share my workouts with {groupName}</span>
          <span className="block font-body text-xs text-steel mt-0.5">
            {allowShare
              ? "Your finished workouts post to the group's feed and count on its leaderboard. Turning this off also takes your earlier workout cards off the group's feed."
              : "Your workouts stay private in the group while you're under 18."}
          </span>
        </span>
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
      {!leaveAsked ? (
        <button type="button" disabled={busy} onClick={() => setLeaveAsked(true)} className="inline-flex items-center min-h-11 mt-2 font-body text-sm text-steel underline underline-offset-2">
          Leave {groupName}
        </button>
      ) : (
        <div className="mt-2 border border-steel/20 p-3">
          <p className="font-body text-sm text-chalk">Leave {groupName}?</p>
          <p className="font-body text-xs text-steel mt-0.5">You stop seeing its feed and chat, and your workout cards come off its feed. Your own training is not changed.</p>
          <div className="mt-2 flex gap-3">
            <button type="button" disabled={busy} onClick={() => void leave()} className="min-h-11 border border-rust/60 px-4 font-body text-sm text-rust disabled:opacity-40">
              {busy ? "Leaving…" : "Leave"}
            </button>
            <button type="button" disabled={busy} onClick={() => setLeaveAsked(false)} className="min-h-11 px-4 font-body text-sm text-steel">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
