"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send } from "lucide-react";

interface ChatMessage {
  role: "coach" | "assistant";
  body: string;
}

// AI Assistant Phase 2 — the Collective Intelligence conversational chat
// (collective_intelligence_phase_2_conversational_assistant.md). "A
// floating chat, alongside the dashboard cards" — general questions stay
// here, don't navigate anywhere. No streaming (resolved deliberately): the
// numeral/name guards have to see the whole answer before the coach does,
// so a brief "Checking…" state stands in for a live-typing effect.
export function CollectiveIntelligenceChat() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  async function handleSend() {
    const question = input.trim();
    if (!question || sending) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "coach", body: question }]);
    setSending(true);

    try {
      const response = await fetch("/api/collective-intelligence/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, message: question }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Something went wrong.");
      }
      const data = await response.json();
      setThreadId(data.threadId);
      setMessages((prev) => [...prev, { role: "assistant", body: data.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close Collective Intelligence chat" : "Open Collective Intelligence chat"}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-rust text-graphite flex items-center justify-center shadow-lg active:opacity-80"
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-40 w-[360px] max-w-[calc(100vw-3rem)] h-[480px] bg-graphite border border-steel/30 shadow-2xl flex flex-col">
          <div className="px-4 py-3 border-b border-steel/20">
            <p className="font-body text-[10px] text-steel uppercase tracking-wide font-bold">
              Collective Intelligence
            </p>
            <p className="font-body text-[11px] text-steel mt-0.5">Ask about a specific client or exercise.</p>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <p className="font-body text-xs text-steel">
                Try: &quot;How has Alice&apos;s squat been trending?&quot; or &quot;When did Ben last log a workout?&quot;
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "coach" ? "text-right" : "text-left"}>
                <p
                  className={`inline-block font-body text-sm px-3 py-2 max-w-[85%] ${
                    m.role === "coach" ? "bg-rust text-graphite" : "bg-surface text-chalk"
                  }`}
                >
                  {m.body}
                </p>
              </div>
            ))}
            {sending && <p className="font-body text-xs text-steel">Checking…</p>}
            {error && <p className="font-body text-xs text-rust">{error}</p>}
          </div>

          <div className="p-3 border-t border-steel/20 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              placeholder="Ask a question…"
              className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="h-9 w-9 flex items-center justify-center bg-rust text-graphite disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
