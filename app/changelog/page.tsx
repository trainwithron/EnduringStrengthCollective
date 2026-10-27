import { HelpShell } from "@/components/support/help-shell";
import { CHANGELOG } from "@/lib/changelog";

export const metadata = { title: "What's new" };

const WHO = { coaches: "For coaches", clients: "For clients", everyone: "For everyone" } as const;

export default function ChangelogPage() {
  return (
    <HelpShell title="What's new" intro="Changes you can see, newest first.">
      <ol className="space-y-6">
        {CHANGELOG.map((e, i) => (
          <li key={i} className="border-l-2 border-steel/30 pl-4">
            <p className="font-body text-xs text-steel">
              <time dateTime={e.date}>{new Date(`${e.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</time> · {WHO[e.audience]}
            </p>
            <h2 className="font-display uppercase text-base tracking-wide mt-1">{e.title}</h2>
            {e.body && <p className="font-body text-sm text-chalk mt-1 max-w-[60ch]">{e.body}</p>}
          </li>
        ))}
      </ol>
    </HelpShell>
  );
}
