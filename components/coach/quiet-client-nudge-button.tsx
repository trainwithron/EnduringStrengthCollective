"use client";

import { useState } from "react";
import { getQuietClientNudgeTemplates } from "@/lib/quiet-client-nudge-templates";

// coach_dashboard_redesign_scoping.md — quiet-client nudge messages, V1.
// Bedford's own research (cited in that memory) shows the real
// retention driver is the personal conversation itself, not just
// awareness of the flag — so this removes as much friction as possible
// from actually sending one, without this app taking on real SMS/DM
// delivery (no athlete phone number is stored anywhere in this schema,
// and that's a deliberately separate, bigger decision). "Sendable in
// one tap" here means the native share sheet where one exists (a real
// text/DM app opens with the message pre-filled), or a clipboard copy
// otherwise — the same fallback shape as components/share/share-workout-button.tsx.
export function QuietClientNudgeButton({ athleteFirstName }: { athleteFirstName: string }) {
  const [open, setOpen] = useState(false);
  const templates = getQuietClientNudgeTemplates(athleteFirstName);
  const [selectedKey, setSelectedKey] = useState<(typeof templates)[number]["key"]>(templates[0].key);
  const [draft, setDraft] = useState(templates[0].text);
  const [copied, setCopied] = useState(false);

  function selectTemplate(key: (typeof templates)[number]["key"]) {
    const template = templates.find((t) => t.key === key);
    if (!template) return;
    setSelectedKey(key);
    setDraft(template.text);
  }

  async function handleSend() {
    if (navigator.share) {
      try {
        await navigator.share({ text: draft });
      } catch {
        // User cancelled the share sheet — not an error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied — nothing to recover, the draft is
      // still visible in the textarea for a manual copy.
    }
  }

  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} className="font-body text-sm text-rust font-medium">
        Message {athleteFirstName} →
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-10 w-80 border border-steel/20 bg-graphite p-3 shadow-lg">
          <div className="flex items-center gap-1.5 mb-2">
            {templates.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => selectTemplate(t.key)}
                className={`h-7 px-2.5 border font-body text-xs ${
                  selectedKey === t.key ? "bg-rust border-rust text-graphite" : "border-steel/30 text-steel"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full bg-surface border border-steel/30 text-chalk px-2 py-1.5 font-body text-sm focus:outline-none focus:border-rust"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={handleSend}
              className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium"
            >
              {copied ? "Copied!" : "Send"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="font-body text-xs text-steel">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
