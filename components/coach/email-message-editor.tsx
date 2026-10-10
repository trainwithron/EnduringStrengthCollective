"use client";

import { useRef, useState } from "react";
import { BODY_MAX, PLACEHOLDERS, SUBJECT_MAX } from "@/lib/message-template";

// "Edit this message": the coach's own wording for the sign-in link email. Opens prefilled with their saved version or the default; the three placeholders are chips that drop
// into the text where the cursor is. The message must keep {link}. Saved for this coach only.
export function EmailMessageEditor() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<"subject" | "body">("body");

  async function openEditor() {
    setOpen(true);
    if (loaded) return;
    setBusy(true);
    try {
      const res = await fetch("/api/coach/message-template");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load the message.");
      setSubject(data.subject);
      setBody(data.body);
      setIsDefault(!!data.isDefault);
      setLoaded(true);
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Couldn't load the message." });
    } finally {
      setBusy(false);
    }
  }

  function insert(token: string) {
    if (lastFocus.current === "subject" && token !== "{link}") {
      const el = subjectRef.current;
      const at = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? at;
      setSubject((s) => s.slice(0, at) + token + s.slice(end));
      return;
    }
    const el = bodyRef.current;
    const at = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? at;
    setBody((b) => b.slice(0, at) + token + b.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/coach/message-template", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, body }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save your message.");
      setSubject(data.subject);
      setBody(data.body);
      setIsDefault(false);
      setMsg({ kind: "ok", text: "Saved. Your clients get this message." });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Couldn't save your message." });
    } finally {
      setBusy(false);
    }
  }

  async function backToDefault() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/coach/message-template", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't go back to the default.");
      setSubject(data.subject);
      setBody(data.body);
      setIsDefault(true);
      setMsg({ kind: "ok", text: "Back to the default message." });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Couldn't go back to the default." });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={openEditor} className="mt-1 min-h-11 font-body text-xs text-steel underline underline-offset-2">
        Edit this message
      </button>
    );
  }

  return (
    <div className="mt-2 border border-steel/25 p-3">
      <p className="font-body text-xs text-steel">
        The email your client gets. {isDefault ? "This is the default message." : "This is your own wording."} Plain text only.
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-2" aria-label="Placeholders">
        {PLACEHOLDERS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => insert(p)}
            className="min-h-11 px-3 border border-steel/40 text-chalk font-body text-xs"
            title={p === "{link}" ? "Required: the client's sign-in link" : "Adds this to the text"}
          >
            {p}
          </button>
        ))}
      </div>
      <label className="block font-body text-xs text-steel mt-3" htmlFor="claim-subject">
        Subject
      </label>
      <input
        id="claim-subject"
        ref={subjectRef}
        value={subject}
        maxLength={SUBJECT_MAX}
        onFocus={() => (lastFocus.current = "subject")}
        onChange={(e) => setSubject(e.target.value)}
        className="block w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
      />
      <label className="block font-body text-xs text-steel mt-3" htmlFor="claim-body">
        Message
      </label>
      <textarea
        id="claim-body"
        ref={bodyRef}
        value={body}
        maxLength={BODY_MAX}
        rows={9}
        onFocus={() => (lastFocus.current = "body")}
        onChange={(e) => setBody(e.target.value)}
        className="block w-full mt-1 bg-graphite border border-steel/30 text-chalk p-2 font-body text-sm focus:outline-none focus:border-rust"
      />
      {!body.includes("{link}") && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          The message needs {"{link}"} in it, or your client has no way to sign in.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button type="button" onClick={save} disabled={busy || !body.includes("{link}") || !subject.trim()} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={backToDefault} disabled={busy || isDefault} className="h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-50">
          Back to the default
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 font-body text-xs text-steel underline underline-offset-2">
          Close
        </button>
      </div>
      {msg && (
        <p className={`font-body text-xs mt-2 ${msg.kind === "error" ? "text-rust" : "text-positive"}`} role={msg.kind === "error" ? "alert" : "status"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
