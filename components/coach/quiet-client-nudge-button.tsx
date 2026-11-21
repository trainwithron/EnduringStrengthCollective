"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { getQuietClientNudgeTemplates } from "@/lib/quiet-client-nudge-templates";
import { coachThreadHref, sendDirectMessage } from "@/lib/direct-message-send";

// coach_dashboard_redesign_scoping.md — quiet-client nudge messages. The personal conversation is what keeps a client (Bedford's research in that memory), so the draft is one tap
// from sent. It goes INSIDE Spotlight now (Ron, Nov 20): Send posts the edited draft as a direct message to this client, the same send and push as the conversation itself
// (lib/direct-message-send.ts), and then says who it went to with a link to the conversation. Only when that send fails is the text offered to copy, so nothing typed is lost.
export function QuietClientNudgeButton({
  athleteId,
  athleteFirstName,
  groupId,
  coachId,
  coachName,
}: {
  athleteId: string;
  athleteFirstName: string;
  groupId: string;
  coachId: string;
  coachName: string;
}) {
  const [open, setOpen] = useState(false);
  const templates = getQuietClientNudgeTemplates(athleteFirstName);
  const [selectedKey, setSelectedKey] = useState<(typeof templates)[number]["key"]>(templates[0].key);
  const [draft, setDraft] = useState(templates[0].text);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [copied, setCopied] = useState(false);

  function selectTemplate(key: (typeof templates)[number]["key"]) {
    const template = templates.find((t) => t.key === key);
    if (!template) return;
    setSelectedKey(key);
    setDraft(template.text);
  }

  async function handleSend() {
    if (!draft.trim() || state === "sending") return;
    setState("sending");
    const sent = await sendDirectMessage(createBrowserClient(), { groupId, senderId: coachId, senderName: coachName, recipientId: athleteId, body: draft });
    setState(sent ? "sent" : "failed");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied: the draft is still in the box to copy by hand.
    }
  }

  const threadHref = coachThreadHref(groupId, athleteId);

  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="font-body text-sm text-rust-ink font-medium min-h-11">
        Message {athleteFirstName} →
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-10 w-80 max-w-[calc(100vw-2rem)] bg-surface-2 rounded-card border border-steel/20 p-3 shadow-lg" data-nudge-panel>
          {state === "sent" ? (
            <div role="status">
              <p className="font-body text-sm text-chalk font-medium">Sent to {athleteFirstName}</p>
              <p className="font-body text-xs text-steel mt-1">It&apos;s in your conversation with them, and they get a notification.</p>
              <div className="flex items-center gap-3 mt-3">
                <Link href={threadHref} className="inline-flex items-center min-h-11 font-body text-sm text-rust-ink font-medium">
                  Open the conversation →
                </Link>
                <button type="button" onClick={() => setOpen(false)} className="min-h-11 font-body text-xs text-steel">
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 mb-2">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => selectTemplate(t.key)}
                    aria-pressed={selectedKey === t.key}
                    className={`h-8 px-3 rounded-token-pill border font-body text-xs ${selectedKey === t.key ? "bg-rust border-rust text-graphite" : "border-steel/30 text-steel"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                aria-label={`Message to ${athleteFirstName}`}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (state === "failed") setState("idle");
                }}
                rows={3}
                className="w-full bg-surface border border-steel/30 text-chalk px-2 py-1.5 font-body text-sm focus:outline-none focus:border-rust"
              />
              {state === "failed" && (
                <p className="font-body text-xs text-rust-ink mt-1" role="alert">
                  That didn&apos;t send. Try again, or copy the text and send it another way.
                </p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={state === "sending" || !draft.trim()}
                  className="h-9 px-4 rounded-token-pill bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
                >
                  {state === "sending" ? "Sending…" : `Send to ${athleteFirstName}`}
                </button>
                {state === "failed" && (
                  <button type="button" onClick={() => void handleCopy()} className="h-9 px-3 border border-steel/30 text-chalk font-body text-xs">
                    {copied ? "Copied" : "Copy text"}
                  </button>
                )}
                <button type="button" onClick={() => setOpen(false)} className="font-body text-xs text-steel">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
