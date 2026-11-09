"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// A one-on-one client is asked, on their Home, whether to join their organization's shared group (Ron, Nov 9: never added automatically; the wording is his). The page renders it only once the
// goal sheet is done, only for the client themselves, and only while they are not in that group (lib/shared-group-join.ts). "Not now" hides it for 30 days on this device.
// A client under 18 is offered only the private join.
export const NOT_NOW_DAYS = 30;

export function SharedGroupJoinCard({
  spaceGroupId,
  athleteId,
  groupId,
  groupName,
  coachName,
  allowShare,
}: {
  spaceGroupId: string;
  athleteId: string;
  groupId: string;
  groupName: string;
  coachName: string;
  allowShare: boolean;
}) {
  const key = `spotlight.sharedGroupJoin.notNow.v1:${athleteId}:${groupId}`;
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<"shared" | "private" | null>(null);

  useEffect(() => {
    try {
      const at = Number(window.localStorage.getItem(key));
      setShow(!at || Date.now() - at > NOT_NOW_DAYS * 24 * 60 * 60 * 1000);
    } catch {
      setShow(true);
    }
  }, [key]);

  async function join(share: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shared-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", spaceGroupId, share }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data?.error as string | undefined) ?? "Couldn't join. Try again.");
        setBusy(false);
        return;
      }
      setJoined(share ? "shared" : "private");
    } catch {
      setError("Couldn't join. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (joined) {
    return (
      <div className="border border-rust/50 bg-surface/40 px-4 py-3" role="status">
        <p className="font-body text-sm text-chalk">You joined {groupName}.</p>
        <p className="font-body text-xs text-steel mt-0.5">
          {joined === "shared" ? "Your finished workouts will post there too." : "Your workouts stay private."} You can change this in Settings.
        </p>
        <Link href={`/groups/${spaceGroupId}/feed`} className="inline-flex items-center min-h-11 mt-1 font-body text-sm text-rust underline underline-offset-2">
          Open the group feed
        </Link>
      </div>
    );
  }

  if (!show) return null;
  return (
    <div className="border border-rust/50 bg-surface/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-body text-sm text-chalk">Join {groupName}</p>
        <button
          type="button"
          aria-label="Hide this for now"
          className="inline-flex items-center min-h-11 -mt-3 font-body text-sm text-steel px-2"
          disabled={busy}
          onClick={() => {
            try {
              window.localStorage.setItem(key, String(Date.now()));
            } catch {
              /* a blocked store just means it shows again next time */
            }
            setShow(false);
          }}
        >
          Not now
        </button>
      </div>
      <p className="font-body text-xs text-steel">Our group of clients training together. You&apos;ll get:</p>
      <ul className="mt-1 space-y-0.5 font-body text-xs text-steel list-disc pl-5">
        <li>Announcements from {coachName}, like schedule changes</li>
        <li>The group chat and PR board</li>
        <li>The leaderboard, if you want to compete</li>
        <li>Encouragement from people putting in the work</li>
      </ul>
      <div className="mt-3 flex flex-col gap-2">
        {allowShare && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void join(true)}
            className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 disabled:opacity-40"
          >
            Join and share my workouts
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void join(false)}
          className={
            allowShare
              ? "min-h-11 border border-steel/40 px-4 font-body text-sm text-chalk disabled:opacity-40"
              : "min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 disabled:opacity-40"
          }
        >
          Join, but keep my workouts private
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
