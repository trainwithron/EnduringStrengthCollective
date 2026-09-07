import Link from "next/link";
import type { FeedChannel } from "@/lib/types";

const CHANNELS: { key: FeedChannel; label: string }[] = [
  { key: "announcements", label: "Announcements" },
  { key: "form_checks", label: "Form Checks" },
  { key: "pr_board", label: "PR Board" },
  { key: "general", label: "General" },
];

export function ChannelTabs({
  basePath,
  active,
}: {
  basePath: string;
  active: FeedChannel;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-steel/20 overflow-x-auto">
      {CHANNELS.map((c) => (
        <Link
          key={c.key}
          href={`${basePath}?channel=${c.key}`}
          className={`h-10 px-4 flex items-center font-body text-sm whitespace-nowrap border-b-2 transition-colors shrink-0 ${
            active === c.key
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}
