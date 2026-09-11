"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function DeleteAccountButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (confirmText !== "DELETE" || deleting) return;
    setDeleting(true);
    setError(null);

    const res = await fetch("/api/account/delete", { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Couldn't delete your account — try again.");
      setDeleting(false);
      return;
    }

    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="font-body text-sm text-rust"
      >
        Delete my account
      </button>
    );
  }

  return (
    <div className="border border-rust/40 bg-rust/5 p-3 space-y-3">
      <p className="font-body text-xs text-chalk">
        This permanently deletes your account, profile, and personal data (posts, habits, wellness
        check-ins, photos, wearable connections). Your logged workouts stay in your coach&apos;s
        records so their program history and business numbers aren&apos;t affected — but they&apos;re
        no longer tied to your name. This can&apos;t be undone.
      </p>
      <label className="block">
        <span className="font-body text-xs text-steel uppercase tracking-wide">
          Type DELETE to confirm
        </span>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="w-full h-10 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
      </label>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleDelete}
          disabled={confirmText !== "DELETE" || deleting}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {deleting ? "Deleting…" : "Permanently delete"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setConfirmText("");
            setError(null);
          }}
          className="font-body text-xs text-steel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
