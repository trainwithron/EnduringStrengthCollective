"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

// A settings change Ask Spot is about to make: what it is now and what it will be. Nothing changes until the coach says yes.
interface ActionCard {
  title: string;
  beforeText: string;
  afterText: string;
  token: string;
  confirmLabel: string;
  caution?: string;
}

interface MessagePreview {
  clientName: string;
  messages: { fromClient: boolean; body: string; at: string }[];
}

interface ChatMessage {
  role: "coach" | "assistant";
  body: string;
  steps?: Step[];
  note?: string | null;
  chips?: Chip[];
  // The question to send to the assistant if the person wants an answer from their data instead.
  askAi?: string;
  // "Johann's program: is this what you're looking for?" One tap (or Enter) opens it; "Not that one" closes it.
  confirm?: { href: string; state: "open" | "closed" };
  card?: ActionCard & { state: "open" | "done" | "cancelled" };
  // After a change: the signed token that puts it back, valid for an hour and only while the setting still has the value the change set.
  undoToken?: string | null;
  preview?: MessagePreview;
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
  const router = useRouter();

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

  function patchMessage(index: number, patch: Partial<ChatMessage>) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  async function runAction(index: number, op: "confirm" | "undo", token: string) {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/assistant/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, token }),
      });
      const data = await response.json().catch(() => ({ ok: false, message: "Something went wrong. Nothing was changed." }));
      if (op === "confirm" && data.ok) patchMessage(index, { card: { ...(messages[index].card as ActionCard), state: "done" } });
      if (op === "undo") patchMessage(index, { undoToken: null });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", body: data.message ?? "Something went wrong. Nothing was changed.", undoToken: data.ok && op === "confirm" ? data.undoToken : null },
      ]);
      // A change of the word for clients is shown everywhere; refresh so every screen says it.
      if (data.ok && data.reload) router.refresh();
    } catch {
      setError("That didn't go through. Nothing was changed.");
    } finally {
      setSending(false);
    }
  }

  // The newest screen-opening question waiting on a yes. Enter in an empty box answers it. A settings change is never answered by a keystroke: it needs a click or tap.
  function pendingIndex(): number {
    const i = messages.length - 1;
    const m = messages[i];
    if (!m) return -1;
    if (m.confirm?.state === "open") return i;
    return -1;
  }

  function answerYes() {
    const i = pendingIndex();
    if (i < 0) return false;
    const m = messages[i];
    if (m.confirm?.state === "open") {
      patchMessage(i, { confirm: { ...m.confirm, state: "closed" } });
      router.push(m.confirm.href);
      return true;
    }
    return false;
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
          if (data.kind === "action" && data.card) {
            setMessages((prev) => [...prev, { role: "assistant", body: data.card.title, card: { ...data.card, state: "open" } }]);
            return;
          }
          if (data.kind === "navigate") {
            const single = data.confirm && data.chips?.length === 1;
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                body: data.text,
                chips: single ? undefined : data.chips,
                confirm: single ? { href: data.chips[0].href, state: "open" } : undefined,
                preview: data.preview ?? undefined,
              },
            ]);
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
            Try: &quot;Open Alice&apos;s profile&quot;, &quot;Set my buffer to 10 minutes&quot;, &quot;What did Alice say in our last chat?&quot; or
            &quot;How has Alice&apos;s squat been trending?&quot;
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
              {m.preview && (
                <div className="mt-2 border border-steel/30 divide-y divide-steel/20">
                  {m.preview.messages.map((pm, k) => (
                    <div key={k} className="px-2 py-1.5">
                      <p className="text-[11px] text-steel">{pm.fromClient ? m.preview!.clientName : "You"}</p>
                      <p className="whitespace-pre-wrap break-words">{pm.body}</p>
                    </div>
                  ))}
                </div>
              )}
              {m.confirm && m.confirm.state === "open" && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <button type="button" onClick={() => answerYes()} className="inline-flex items-center h-8 px-3 bg-rust text-graphite font-body text-xs font-medium">
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => patchMessage(i, { confirm: { ...m.confirm!, state: "closed" } })}
                    className="inline-flex items-center h-8 px-3 border border-steel/40 text-steel font-body text-xs"
                  >
                    Not that one
                  </button>
                </div>
              )}
              {m.card && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-steel">
                    Now: <span className="text-chalk">{m.card.beforeText}</span>
                  </p>
                  <p className="text-xs text-steel">
                    After: <span className="text-chalk">{m.card.afterText}</span>
                  </p>
                  {m.card.caution && <p className="text-xs text-rust">{m.card.caution}</p>}
                  {m.card.state === "open" && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => runAction(i, "confirm", m.card!.token)}
                        className="inline-flex items-center h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
                      >
                        {m.card.confirmLabel}
                      </button>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => patchMessage(i, { card: { ...m.card!, state: "cancelled" } })}
                        className="inline-flex items-center h-8 px-3 border border-steel/40 text-steel font-body text-xs"
                      >
                        No
                      </button>
                    </div>
                  )}
                  {m.card.state === "cancelled" && <p className="text-xs text-steel">Left as it was.</p>}
                </div>
              )}
              {m.undoToken && (
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => runAction(i, "undo", m.undoToken!)}
                  className="mt-2 inline-flex items-center h-8 px-3 border border-rust text-rust font-body text-xs font-medium disabled:opacity-40"
                >
                  Undo
                </button>
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
            if (e.key === "Enter") {
              if (e.nativeEvent.isComposing) return;
              if (!input.trim() && answerYes()) return;
              handleSend();
            }
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
