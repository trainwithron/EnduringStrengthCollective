"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

interface ChatMessage {
  role: "coach" | "assistant";
  body: string;
}

// The actual "Ask Spot" chat content — message list, input, send — with
// no opinion about what container it sits in. Extracted
// (mobile_more_tab_condensed_widget_hub_sept30.md) so the exact same
// chat can render both inside the desktop edge-tab
// (collective-intelligence-chat.tsx, which keeps its own header/drag
// gestures) and as one inline tile of the mobile "More" drawer
// (coach-more-drawer.tsx) — one real chat thread implementation, two
// different surrounding shells, not two copies of this logic.
export function AskSpotChatPanel() {
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
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
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

      <div className="p-3 border-t border-steel/20 flex gap-2 shrink-0">
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
  );
}
