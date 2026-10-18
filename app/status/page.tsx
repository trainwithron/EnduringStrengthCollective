import { HelpShell } from "@/components/support/help-shell";
import { readHealth } from "@/lib/health-check";

export const metadata = { title: "Status" };
// Read fresh every time: a status page that shows yesterday's answer is worse than none.
export const dynamic = "force-dynamic";

type Part = { name: string; state: "ok" | "attention" | "down" | "paused"; note: string };

export default async function StatusPage() {
  const reading = await readHealth();
  const body = reading.body as { database?: string; ai?: string; jobs?: { status?: string } };
  const parts: Part[] = [
    reading.status === "error"
      ? { name: "The app and its data", state: "down", note: "We cannot reach our data right now. We are on it." }
      : { name: "The app and its data", state: "ok", note: "Working." },
  ];
  if (reading.status !== "error") {
    parts.push(
      body.jobs?.status === "attention"
        ? { name: "Background work (reminders, check-ins, billing records)", state: "attention", note: "Some of it is running late. Nothing is lost; it catches up." }
        : { name: "Background work (reminders, check-ins, billing records)", state: "ok", note: "Running." },
      body.ai === "on" ? { name: "AI features", state: "ok", note: "On." } : { name: "AI features", state: "paused", note: "Paused for now." }
    );
  }
  const headline =
    reading.status === "error" ? "We are having trouble" : reading.status === "degraded" ? "Working, with some work running late" : "Everything is working";
  const tone = reading.status === "ok" ? "text-chalk" : "text-rust";
  return (
    <HelpShell title="Status" intro="Checked when you opened this page.">
      <p className={`font-display uppercase text-xl tracking-wide ${tone}`} role="status">
        {headline}
      </p>
      <ul className="mt-6 divide-y divide-steel/15 border border-steel/20 font-body">
        {parts.map((p) => (
          <li key={p.name} className="p-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-chalk">{p.name}</p>
              <p className="text-xs text-steel mt-0.5">{p.note}</p>
            </div>
            <span className={`text-xs uppercase tracking-wide shrink-0 ${p.state === "ok" ? "text-steel" : "text-rust"}`}>
              {p.state === "ok" ? "OK" : p.state === "attention" ? "Delayed" : p.state === "paused" ? "Paused" : "Down"}
            </span>
          </li>
        ))}
      </ul>
      <p className="font-body text-xs text-steel mt-4">Checked {new Date(String(reading.body.timestamp)).toUTCString()}.</p>
    </HelpShell>
  );
}
