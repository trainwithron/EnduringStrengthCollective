"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/shared/confirm-dialog";

export interface RequestRow {
  id: string;
  /** first name and last initial, for everyone, until the coach approves */
  name: string;
  ageBand: "adult" | "teen" | "unknown";
  createdAt: string;
}

const NEXT_STEP: Record<string, string> = {
  adult: "They were told to open the app, where a short health form comes first.",
  teen: "They are under 18, so a parent or guardian has to sign a consent form before they can log workouts. They were told, and the app walks them through it.",
  unknown: "They were told to open the app, where it will ask for their date of birth and a short health form first.",
};

// The coach's waiting requests (people who tapped "Request to train with me" on their public page). Approve makes an ordinary client with their own one-on-one space; Decline tells the person only that the coach is not
// taking new clients right now. Names show as first name and last initial, with no photo, until the coach approves. Nothing here shares anything about any client.
export function ClientRequestsPanel({ organizationId, requests, supportEmail }: { organizationId: string; requests: RequestRow[]; supportEmail: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, { kind: "ok" | "problem"; text: string; help?: boolean }>>({});
  const [bulk, setBulk] = useState<string | null>(null);

  async function answer(r: RequestRow, action: "approve" | "decline") {
    if (busy) return;
    setBusy(r.id);
    try {
      const res = await fetch("/api/client-requests/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: r.id, action }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setAnswers((a) => ({ ...a, [r.id]: { kind: "problem", text: data.error || "Couldn't do that. Try again." } }));
      else if (data.ok === false) {
        setAnswers((a) => ({ ...a, [r.id]: { kind: "problem", text: data.error || "That request was closed.", help: data.code === "dob_mismatch" } }));
        // a closed request leaves the list; one that needs support stays waiting
        if (data.code !== "dob_mismatch") router.refresh();
      } else {
        setAnswers((a) => ({ ...a, [r.id]: { kind: "ok", text: action === "approve" ? `${r.name} is now your client. ${NEXT_STEP[data.ageBand ?? r.ageBand] ?? NEXT_STEP.unknown}` : `Declined. ${r.name} was told only that you are not taking new clients right now.` } }));
        router.refresh();
      }
    } catch {
      setAnswers((a) => ({ ...a, [r.id]: { kind: "problem", text: "Couldn't do that. Check your connection and try again." } }));
    } finally {
      setBusy(null);
    }
  }

  async function declineAll() {
    if (busy || requests.length === 0) return;
    if (!(await confirmDialog({ message: `Decline all ${requests.length} waiting requests? Each person is told only that you are not taking new clients right now.`, confirmLabel: "Decline all", cancelLabel: "Keep them", destructive: true }))) return;
    setBusy("all");
    try {
      const res = await fetch("/api/client-requests/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "decline_all", organizationId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setBulk(data.error || "Couldn't decline them. Try again.");
      else {
        setBulk(`Declined ${data.declined ?? 0}.`);
        router.refresh();
      }
    } catch {
      setBulk("Couldn't decline them. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const small = "font-body text-xs underline disabled:opacity-40";
  return (
    <div className="space-y-4 max-w-3xl">
      <section aria-label="Waiting requests" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display uppercase text-lg tracking-wide">Waiting for you ({requests.length})</h2>
          {requests.length > 1 && (
            <button type="button" onClick={declineAll} disabled={busy !== null} className={`${small} text-rust`}>
              {busy === "all" ? "Declining…" : "Decline all waiting"}
            </button>
          )}
        </div>
        <p className="font-body text-xs text-steel">Names show as first name and last initial, with no photo, until you approve. Then they are your client and you see them in full.</p>
        {bulk && (
          <p className="font-body text-xs text-chalk" role="status">
            {bulk}
          </p>
        )}
        {requests.length === 0 && Object.keys(answers).length === 0 ? (
          <p className="font-body text-sm text-steel">No one is waiting. When someone taps Request to train with me on your public page, their request shows up here.</p>
        ) : (
          <ul className="divide-y divide-steel/15 border border-steel/20">
            {requests.map((r) => (
              <li key={r.id} className="p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm">
                      <b>{r.name}</b>
                      {r.ageBand === "teen" && <span className="text-steel text-xs ml-2">Under 18</span>}
                    </p>
                    {r.ageBand === "teen" && <p className="font-body text-xs text-steel mt-1">If you accept, a parent or guardian has to sign a consent form before they can log workouts. The app tells them and walks them through it.</p>}
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <button type="button" onClick={() => answer(r, "approve")} disabled={busy !== null} className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                      {busy === r.id ? "…" : "Approve"}
                    </button>
                    <button type="button" onClick={() => answer(r, "decline")} disabled={busy !== null} className={`${small} text-steel`}>
                      Decline
                    </button>
                  </div>
                </div>
                {answers[r.id] && (
                  <p className={`font-body text-xs ${answers[r.id].kind === "ok" ? "text-positive" : "text-rust"}`} role={answers[r.id].kind === "ok" ? "status" : "alert"}>
                    {answers[r.id].text}
                    {answers[r.id].help && (
                      <>
                        {" "}
                        <Link href="/help" className="underline underline-offset-2">
                          Contact support
                        </Link>
                        {supportEmail ? (
                          <>
                            {" "}
                            or write to{" "}
                            <a href={`mailto:${supportEmail}`} className="underline underline-offset-2">
                              {supportEmail}
                            </a>
                          </>
                        ) : null}
                        .
                      </>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* answers for requests that have just left the list after the refresh */}
        {Object.entries(answers)
          .filter(([id]) => !requests.some((r) => r.id === id))
          .map(([id, a]) => (
            <p key={id} className={`font-body text-xs ${a.kind === "ok" ? "text-positive" : "text-rust"}`} role="status">
              {a.text}
            </p>
          ))}
      </section>
    </div>
  );
}
