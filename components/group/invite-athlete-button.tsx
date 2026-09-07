"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";

function randomCode(length = 10) {
  // Excludes visually ambiguous characters (0/O, 1/l/I) since this gets
  // read aloud or retyped as often as it gets clicked.
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function InviteAthleteButton({
  groupId,
  createdBy,
}: {
  groupId: string;
  createdBy: string;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);

    const supabase = createBrowserClient();
    const code = randomCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase.from("group_invites").insert({
      group_id: groupId,
      code,
      role: "athlete",
      created_by: createdBy,
      expires_at: expiresAt,
    });

    if (insertError) {
      setError("Couldn't create an invite link.");
      setGenerating(false);
      return;
    }

    setLink(`${window.location.origin}/invite/${code}`);
    setGenerating(false);
  }

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (link) {
    return (
      <div className="w-full border border-steel/30 p-3 max-w-md">
        <p className="font-body text-xs text-steel mb-2">
          Invite link &middot; expires in 7 days
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
            className="flex-1 h-10 min-w-0 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="h-10 px-3 border border-rust text-rust font-body text-xs shrink-0"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="inline-flex items-center gap-2 h-11 px-4 rounded-none border border-rust text-rust font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors disabled:opacity-40"
      >
        <Plus className="w-4 h-4" strokeWidth={2.5} />
        {generating ? "Generating…" : "Invite athlete"}
      </button>
      {error && <p className="font-body text-xs text-rust mt-2">{error}</p>}
    </div>
  );
}
