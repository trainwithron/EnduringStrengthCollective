"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { MicButton } from "@/components/shared/mic-button";
import { CHAPTERS, INTRO_TEXT, type InviteKind, type ProposedRule } from "@/lib/conversation-chapters";

interface Msg {
  role: "coach" | "assistant";
  body: string;
}
interface Readback {
  readback: string;
  rules: ProposedRule[];
}

async function call(body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch("/api/ai/coach-conversation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: {} };
  }
}

const small = "min-h-11 px-3 font-body text-sm border border-steel/30 text-steel hover:text-chalk disabled:opacity-40";

// The chapters conversation: the app asks, one question at a time, how the coach programs; the coach types or talks. It can be skipped and resumed. At the end it reads back what it
// heard, and nothing is saved until the coach says that is right (and each line can be dropped first).
function ConversationPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const chapter = CHAPTERS[0];
  const [messages, setMessages] = useState<Msg[]>([]);
  const [turns, setTurns] = useState(0);
  const [status, setStatus] = useState<string>("loading");
  const [readback, setReadback] = useState<Readback | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await call({ action: "start" });
      if (cancelled) return;
      if (!r.ok) {
        setError(r.data?.error ?? "I couldn't start just now. Try again.");
        setStatus("error");
        return;
      }
      setMessages(r.data.messages ?? []);
      setTurns(r.data.turns ?? 0);
      setReadback(r.data.readback ?? null);
      setStatus(r.data.status);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, readback]);

  async function send() {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { role: "coach", body: message }]);
    setText("");
    const r = await call({ action: "say", message });
    setBusy(false);
    if (!r.ok) {
      setError(r.data?.error ?? "I didn't catch that. Try again.");
      return;
    }
    setTurns(r.data.turns ?? turns + 1);
    setMessages((m) => [...m, { role: "assistant", body: r.data.reply }]);
    if (r.data.readback) setReadback(r.data.readback);
  }

  async function save() {
    if (!readback || busy) return;
    setBusy(true);
    const r = await call({ action: "finish", rules: readback.rules });
    setBusy(false);
    if (!r.ok) {
      setError(r.data?.error ?? "That didn't save. Nothing was changed.");
      return;
    }
    setSaved(r.data.saved ?? 0);
    setStatus("done");
    router.refresh();
  }

  async function notQuite() {
    setBusy(true);
    await call({ action: "reopen" });
    setBusy(false);
    setReadback(null);
  }

  async function skip() {
    setBusy(true);
    await call({ action: "skip" });
    setBusy(false);
    onClose();
  }

  return (
    <div className="mt-3 border border-steel/25 bg-surface/40 p-3 max-w-2xl" aria-label={`${chapter.title}, conversation`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="font-display uppercase text-xs tracking-wide text-steel">
          {chapter.title}
          {CHAPTERS.length > 1 ? ` (chapter 1 of ${CHAPTERS.length})` : ""} · about {chapter.minutes}
        </p>
        <button type="button" onClick={onClose} className="font-body text-xs text-steel underline min-h-11 px-2">
          Close
        </button>
      </div>
      {status === "loading" && <p className="font-body text-sm text-steel">Getting ready…</p>}
      {(status === "done" || saved !== null) && (
        <p className="font-body text-sm text-chalk" role="status">
          {saved ? `Saved ${saved} ${saved === 1 ? "thing" : "things"}. You can change or remove any of it in What I've learned about how you coach.` : "That chapter is finished. Nothing new was saved."}
        </p>
      )}
      {status === "active" && saved === null && (
        <>
          <div className="space-y-2 max-h-72 overflow-y-auto" aria-live="polite">
            {messages.map((m, i) => (
              <p key={i} className={`font-body text-sm ${m.role === "assistant" ? "text-steel" : "text-chalk text-right"}`}>
                {m.body}
              </p>
            ))}
            <div ref={endRef} />
          </div>
          {readback ? (
            <div className="mt-3 border-t border-steel/20 pt-3">
              {readback.rules.length > 0 && (
                <ul className="font-body text-sm text-chalk space-y-1">
                  {readback.rules.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="flex-1">
                        When {r.condition}: {r.preference}
                      </span>
                      <button type="button" className="min-h-11 px-2 text-xs underline text-steel" onClick={() => setReadback({ ...readback, rules: readback.rules.filter((_, j) => j !== i) })}>
                        Drop
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={small} disabled={busy} onClick={save}>
                  Yes, that&apos;s right. Save it
                </button>
                <button type="button" className={small} disabled={busy} onClick={notQuite}>
                  Not quite
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <p className="font-body text-xs text-steel mb-1">
                Answer {Math.min(turns + 1, chapter.maxCoachTurns)} of about {chapter.maxCoachTurns}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  aria-label="Your answer"
                  placeholder="Type, or tap Mic and talk"
                  className="flex-1 min-w-48 bg-transparent border border-steel/25 px-2 py-1 text-chalk text-sm"
                />
                <MicButton onText={(t) => setText((x) => (x ? `${x} ${t}` : t))} />
                <button type="button" className={small} disabled={busy || !text.trim()} onClick={send}>
                  {busy ? "…" : "Send"}
                </button>
              </div>
              <button type="button" className="mt-2 min-h-11 font-body text-xs underline text-steel" disabled={busy} onClick={skip}>
                Skip this for now
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="mt-2 font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// The one quiet invitation (Start / Not now / Don't ask me questions), and, wherever `entry` is set, a plain button to talk any time. Never a popup.
export function CoachConversation({ coachId, invite, entry = false }: { coachId: string; invite: InviteKind; entry?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  // The first time the invitation (or its one reminder) is on screen, note it, so it can be shown for a week at most and never again after that.
  useEffect(() => {
    if (invite === "none") return;
    const row: Record<string, unknown> = { coach_id: coachId, invite_state: "shown", invite_shown_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (invite === "reminder") row.invite_reminders = 1;
    void createBrowserClient().from("coach_learning_settings").upsert(row);
  }, [invite, coachId]);

  async function setInvite(patch: Record<string, unknown>) {
    await createBrowserClient().from("coach_learning_settings").upsert({ coach_id: coachId, ...patch, updated_at: new Date().toISOString() });
  }

  return (
    <div>
      {invite !== "none" && !hidden && !open && (
        <div className="mb-6 border border-steel/20 bg-surface/40 p-3 max-w-2xl" role="region" aria-label="Help me learn how you coach">
          <p className="font-body text-sm text-steel">{INTRO_TEXT}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={small} onClick={() => setOpen(true)}>
              Start
            </button>
            <button
              type="button"
              className={small}
              onClick={async () => {
                setHidden(true);
                await setInvite({ invite_state: "later" });
              }}
            >
              Not now
            </button>
            <button
              type="button"
              className={small}
              onClick={async () => {
                setHidden(true);
                await setInvite({ invite_state: "declined", questions_enabled: false });
              }}
            >
              Don&apos;t ask me questions
            </button>
          </div>
        </div>
      )}
      {open ? (
        <ConversationPanel onClose={() => setOpen(false)} />
      ) : (
        entry && (
          <button type="button" className={small} onClick={() => setOpen(true)}>
            Talk with me about how you program
          </button>
        )
      )}
    </div>
  );
}
