"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface BlockedMember {
  id: string;
  name: string;
}

// Settings: the members this person has blocked, each with Unblock. Hidden when nobody is blocked.
export function BlockedMembersList({ initial }: { initial: BlockedMember[] }) {
  const [members, setMembers] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (members.length === 0) return null;

  async function unblock(id: string) {
    if (busy) return;
    setBusy(id);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(null);
      setError("That didn't work. Reload and try again.");
      return;
    }
    const { error: deleteError } = await supabase.from("user_blocks").delete().eq("blocker_id", user.id).eq("blocked_id", id);
    setBusy(null);
    if (deleteError) {
      setError("That didn't work. They are still blocked. Try again.");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="font-body text-sm">
      <p className="text-xs text-steel mb-2">You don&apos;t see posts or comments from these members. They are not told.</p>
      <ul className="divide-y divide-steel/15 border border-steel/20">
        {members.map((m) => (
          <li key={m.id} className="p-3 flex items-center justify-between gap-3">
            <span className="text-chalk">{m.name}</span>
            <button type="button" onClick={() => void unblock(m.id)} disabled={busy !== null} className="min-h-8 text-rust underline underline-offset-2 disabled:opacity-40">
              Unblock
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
