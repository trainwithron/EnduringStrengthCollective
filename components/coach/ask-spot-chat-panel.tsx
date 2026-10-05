"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";

interface Chip {
  label: string;
  href: string;
}

interface Step {
  text: string;
  href?: string;
  linkLabel?: string;
}

interface ChatMessage {
  role: "coach" | "assistant";
  body: string;
  steps?: Step[];
  note?: string | null;
  chips?: Chip[];
  // The question to send to the assistant if the person wants an answer from their data instead.
  askAi?: string;
}

// The actual "Ask Spot" chat content — message list, input, send — with
// no opinion about what container it sits in. Extracted
// (mobile_more_tab_condensed_widget_hub_sept30.md) so the exact same
// chat can render both inside the desktop edge-tab
// (collective-intelligence-chat.tsx, which keeps its own header/drag
// gestures) and as the Ask Spot tile of the mobile Spotlight hub
// (coach-spot-hub.tsx) — one real chat thread implementation, two
// different surrounding shells, not two copies of this logic.
//
// Every message goes to the free navigation and how-to layer first (/api/assistant/navigate). Where to find something, how
// to do something, "open Jordan's profile": answered there with buttons and steps, no AI call. Only a real question about
// someone's data (or a press of "Ask the assistant") goes on to the AI chat.
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

  async function askAssistant(question: string, fallbackChips: Chip[] = []) {
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
      // Never a dead end: say what went wrong and still offer somewhere to go.
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
      if (fallbackChips.length > 0) {
        setMessages((prev) => [...prev, { role: "assistant", body: "In the meantime, these are the main places:", chips: fallbackChips }]);
      }
    }
  }

  async function handleSend(forcedQuestion?: string) {
    const question = (forcedQuestion ?? input).trim();
    if (!question || sending) return;
    if (!forcedQuestion) setInput("");
    setError(null);
    if (!forcedQuestion) setMessages((prev) => [...prev, { role: "coach", body: question }]);
    setSending(true);

    try {
      if (forcedQuestion) {
        await askAssistant(question);
        return;
      }

      let fallbackChips: Chip[] = [];
      try {
        const nav = await fetch("/api/assistant/navigate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: question,
            pagePath: window.location.pathname,
            viewportWidth: window.innerWidth,
          }),
        });
        if (nav.ok) {
          const data = await nav.json();
          if (data.kind === "howto") {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", body: data.text, steps: data.steps, note: data.note, chips: data.chips },
            ]);
            return;
          }
          if (data.kind === "navigate") {
            setMessages((prev) => [...prev, { role: "assistant", body: data.text, chips: data.chips }]);
            return;
          }
          if (data.kind === "unsure") {
            setMessages((prev) => [...prev, { role: "assistant", body: data.text, chips: data.chips, askAi: question }]);
            return;
          }
          fallbackChips = data.chips ?? [];
        }
      } catch {
        // The free layer is unreachable: fall through to the assistant.
      }

      await askAssistant(question, fallbackChips);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="font-body text-xs text-steel">
            Try: &quot;Open Alice&apos;s profile&quot;, &quot;How do I assign sessions?&quot; or &quot;How has Alice&apos;s squat been
            trending?&quot;
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "coach" ? "text-right" : "text-left"}>
            <div
              className={`inline-block text-left font-body text-sm px-3 py-2 max-w-[85%] ${
                m.role === "coach" ? "bg-rust text-graphite" : "bg-surface text-chalk"
              }`}
            >
              <p>{m.body}</p>
              {m.steps && m.steps.length > 0 && (
                <ol className="list-decimal pl-5 mt-2 space-y-1.5">
                  {m.steps.map((s, j) => (
                    <li key={j}>
                      {s.text}
                      {s.href && (
                        <>
                          {" "}
                          <Link href={s.href} className="text-rust underline">
                            {s.linkLabel ?? "Open"}
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {m.note && <p className="text-xs text-steel mt-2">{m.note}</p>}
              {m.chips && m.chips.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {m.chips.map((c) => (
                    <Link
                      key={c.href + c.label}
                      href={c.href}
                      className="inline-flex items-center h-8 px-3 border border-rust text-rust font-body text-xs font-medium"
                    >
                      {c.label} &rarr;
                    </Link>
                  ))}
                </div>
              )}
              {m.askAi && (
                <button
                  type="button"
                  onClick={() => handleSend(m.askAi)}
                  disabled={sending}
                  className="mt-2 font-body text-xs text-steel underline disabled:opacity-40"
                >
                  Ask the assistant instead
                </button>
              )}
            </div>
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
          onClick={() => handleSend()}
          disabled={sending || !input.trim()}
          aria-label="Send"
          className="h-9 w-9 flex items-center justify-center bg-rust text-graphite disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
