"use client";

import { useState } from "react";

interface WebhookSubscriptionRow {
  id: string;
  event_type: string;
  target_url: string;
  created_at: string;
}

// Coach's own side of the Zapier integration: generate the API key
// Zapier's platform authenticates with (bearer token, hashed at rest —
// see lib/api-key.ts), and see what's currently subscribed. Actually
// creating/removing a Zap happens in Zapier's own UI once this app has
// a real Zapier Developer Platform app definition (a separate, later
// step) — this page never writes webhook_subscriptions directly.
export function ZapierSettings({ initialSubscriptions }: { initialSubscriptions: WebhookSubscriptionRow[] }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/api-key", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't generate a key.");
      setApiKey(json.apiKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't generate a key.");
    }
    setGenerating(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="border border-rust/40 bg-rust/5 p-3">
        <p className="font-body text-xs text-chalk">
          This key lets Zapier connect to your account and watch for events (a new client, a
          completed workout, a PR, a package purchase). Anyone with the key can subscribe to your
          events — treat it like a password and only paste it into Zapier itself.
        </p>
      </div>

      <div className="border border-steel/30 p-4 space-y-3">
        <p className="font-body text-sm text-chalk">Zapier API key</p>
        {apiKey ? (
          <div className="space-y-2">
            <code className="block bg-surface border border-steel/30 px-3 py-2 font-body text-xs text-chalk break-all">
              {apiKey}
            </code>
            <p className="font-body text-xs text-rust">
              Copy this now — it won&apos;t be shown again. Generating a new key immediately
              invalidates this one.
            </p>
          </div>
        ) : (
          <p className="font-body text-xs text-steel">
            No key visible here — generate a new one below (this also replaces any existing key).
          </p>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="px-4 py-2 bg-rust text-chalk font-body text-sm disabled:opacity-50"
        >
          {generating ? "Generating…" : apiKey ? "Generate a new key" : "Generate key"}
        </button>
        {error && <p className="font-body text-xs text-rust">{error}</p>}
      </div>

      <div>
        <p className="font-body text-sm text-chalk mb-2">Active Zaps</p>
        {initialSubscriptions.length === 0 ? (
          <p className="font-body text-xs text-steel">No Zaps subscribed yet.</p>
        ) : (
          <div className="border border-steel/30 divide-y divide-steel/20">
            {initialSubscriptions.map((sub) => (
              <div key={sub.id} className="px-3 py-2 flex items-center justify-between">
                <span className="font-body text-sm text-chalk">{sub.event_type.replace("_", " ")}</span>
                <span className="font-body text-xs text-steel truncate max-w-[16rem]">{sub.target_url}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
