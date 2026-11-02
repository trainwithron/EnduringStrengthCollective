"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseCardCsv } from "@/lib/checkin-cards";

// Bring every key card over at once from a member export (Mindbody's client list, or any CSV with a barcode or card column and a name or email column). The rows are matched
// to clients on the server (by email, then by full name) and linked; the ones that matched nobody are listed so they can be linked by hand.
export function CardCsvImport({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ linked: number; taken: string[]; unmatched: string[]; skipped: number } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setResult(null);
    if (file.size > 5 * 1024 * 1024) return setError("That file is over 5 MB. Export only the client list.");
    const parsed = parseCardCsv(await file.text());
    if ("error" in parsed) return setError(parsed.error);
    if (parsed.rows.length === 0) return setError("No rows with a card number were found in that file.");
    setBusy(true);
    try {
      const res = await fetch("/api/kiosk/cards/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, rows: parsed.rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't bring the cards in. Try again.");
      setResult({ linked: data.linked ?? 0, taken: data.taken ?? [], unmatched: data.unmatched ?? [], skipped: parsed.skipped });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't bring the cards in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-steel/20 p-4 mb-6">
      <p className="font-body text-sm text-chalk font-medium">Bring your members&apos; key cards over</p>
      <p className="font-body text-xs text-steel mt-1 max-w-[70ch]">
        Export your client list from your old system (Mindbody or another) as a CSV file and upload it here. Each card is matched to a client by email, then by name.
      </p>
      <label className={`mt-3 inline-flex h-9 px-4 items-center border font-body text-sm cursor-pointer ${busy ? "border-steel/30 text-steel" : "border-rust text-rust"}`}>
        {busy ? "Linking cards…" : "Upload CSV"}
        <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} className="hidden" />
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="font-body text-xs mt-3 space-y-1" role="status">
          <p className="text-positive">
            Linked {result.linked} card{result.linked === 1 ? "" : "s"}.
          </p>
          {result.unmatched.length > 0 && (
            <p className="text-steel">
              No client found for {result.unmatched.length}: {result.unmatched.slice(0, 12).join(", ")}
              {result.unmatched.length > 12 ? `, and ${result.unmatched.length - 12} more` : ""}. Link those by hand below, or add them as clients first.
            </p>
          )}
          {result.taken.length > 0 && <p className="text-rust">Already another client&apos;s card: {result.taken.slice(0, 12).join(", ")}.</p>}
          {result.skipped > 0 && <p className="text-steel">{result.skipped} row{result.skipped === 1 ? "" : "s"} had no card number and were skipped.</p>}
        </div>
      )}
    </div>
  );
}
