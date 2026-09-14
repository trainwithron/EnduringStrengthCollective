"use client";

import { useRef, useState, useEffect } from "react";
import { MessageCircleQuestion, ChevronDown, ChevronUp } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";

interface ChatMessage {
  role: "coach" | "assistant";
  body: string;
  proposedRule?: { condition: string; preference: string } | null;
}

// AI Program Builder conversational learning
// (ai_program_builder_conversational_learning_idea.md) — a coach can ask
// the AI "why did you do that" about a program it generated, push back
// with a correction, and have the AI turn that into a properly-scoped
// standing preference for future generations. Inline/collapsible, not a
// floating global button like Collective Intelligence's chat — this one
// is scoped to a single program, not the whole app.
export function ProgramChatPanel({
  programId,
  groupId,
  programName,
}: {
  programId: string;
  groupId: string;
  programName: string;
}) {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingRuleFor, setSavingRuleFor] = useState<number | null>(null);
  const [savedRuleIndices, setSavedRuleIndices] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, open]);

  async function handleSend() {
    const question = input.trim();
    if (!question || sending) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "coach", body: question }]);
    setSending(true);

    try {
      const response = await fetch("/api/ai/program-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, programId, message: question }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Something went wrong.");
      }
      const data = await response.json();
      setThreadId(data.threadId);
      setMessages((prev) => [...prev, { role: "assistant", body: data.reply, proposedRule: data.proposedRule }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setSending(false);
    }
  }

  async function confirmRule(index: number, rule: { condition: string; preference: string }) {
    setSavingRuleFor(index);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const response = await fetch("/api/ai/program-chat/confirm-rule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ condition: rule.condition, preference: rule.preference, sourceProgramId: programId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Couldn't save that preference.");
      }
      setSavedRuleIndices((prev) => new Set(prev).add(index));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that preference — try again.");
    } finally {
      setSavingRuleFor(null);
    }
  }

  return (
    <div className="border border-steel/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3"
      >
        <span className="flex items-center gap-2 font-body text-sm text-chalk">
          <MessageCircleQuestion className="w-4 h-4 text-rust shrink-0" strokeWidth={2.25} />
          Ask the AI why it built this program this way
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-steel shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-steel shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-steel/20 flex flex-col h-[420px]">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <p className="font-body text-xs text-steel">
                Try: &quot;Why did you put box jumps last?&quot; or &quot;Next time, put explosive work
                first.&quot;
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
                {m.proposedRule && (
                  <div className="mt-2 border border-rust/40 bg-rust/5 p-3 text-left max-w-[85%] ml-0">
                    <p className="font-body text-[10px] text-rust uppercase tracking-wide font-bold mb-1">
                      Proposed standing preference
                    </p>
                    <p className="font-body text-xs text-chalk">
                      When <span className="text-steel">{m.proposedRule.condition}</span>:{" "}
                      {m.proposedRule.preference}
                    </p>
                    {savedRuleIndices.has(i) ? (
                      <p className="font-body text-xs text-positive mt-2">Saved — this now applies going forward.</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => confirmRule(i, m.proposedRule!)}
                        disabled={savingRuleFor === i}
                        className="mt-2 h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-50"
                      >
                        {savingRuleFor === i ? "Saving…" : "Save this as a standing preference"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {sending && <p className="font-body text-xs text-steel">Thinking…</p>}
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
              placeholder={`Ask about ${programName}…`}
              className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
            >
              Ask
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
