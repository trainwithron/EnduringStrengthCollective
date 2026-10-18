import { createServerClient } from "@/lib/supabase/server";
import { ReportedItemActions } from "./reported-item-actions";

interface ReportRow {
  id: string;
  reason: string;
  created_at: string;
  post_id: string | null;
  comment_id: string | null;
  content_kind: "post" | "comment";
  content_excerpt: string | null;
  reported_author_id: string | null;
}

export const PANEL_LIMIT = 20;

// For whoever handles reports: the open reports, newest first, with what was reported (a short copy, so it is still here if the post is later removed), why, and the two things that can be done. The database decides who
// may read a report: the group's coaches other than the person reported; with no other coach, the organization's owner and admins; with none, the platform administrators. The reporter is not named and cannot be (their id is a
// column nobody can select). With a groupId the panel shows that group's reports; without one (the platform administrators' page) every open report the viewer may handle.
// Not shown when there is nothing open, or while the reports table is not there yet.
export async function ReportedContentPanel({ groupId, title = "Reported in this group" }: { groupId?: string; title?: string }) {
  const supabase = await createServerClient();
  const base = () => {
    let q = supabase.from("content_reports").select("id, reason, created_at, post_id, comment_id, content_kind, content_excerpt, reported_author_id", { count: "exact" }).eq("status", "open");
    if (groupId) q = q.eq("group_id", groupId);
    return q;
  };
  const { data, error, count } = await base().order("created_at", { ascending: false }).limit(PANEL_LIMIT);
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "42P01" || code === "PGRST205") return null;
    return (
      <p className="font-body text-sm text-rust mb-4" role="alert">
        Couldn&apos;t load reported posts. Reload to try again.
      </p>
    );
  }
  const rows = (data ?? []) as unknown as ReportRow[];
  if (rows.length === 0) return null;
  const total = count ?? rows.length;
  const authorIds = [...new Set(rows.map((r) => r.reported_author_id).filter((x): x is string => !!x))];
  const { data: people } = authorIds.length > 0 ? await supabase.from("profiles").select("id, full_name").in("id", authorIds) : { data: [] };
  const names = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "A member"]));

  return (
    <section aria-label="Reported posts" className="border border-rust/40 bg-rust/5 p-4 mb-6">
      <h2 className="font-display uppercase text-sm tracking-wide text-rust">
        {title} ({total})
      </h2>
      {total > rows.length && <p className="font-body text-xs text-steel mt-1">Showing the newest {rows.length} of {total}.</p>}
      <ul className="mt-3 divide-y divide-steel/15">
        {rows.map((r) => {
          const contentGone = r.content_kind === "comment" ? !r.comment_id : !r.post_id;
          return (
            <li key={r.id} className="py-3 font-body text-sm">
              <p className="text-xs text-steel">
                {r.content_kind === "comment" ? "Comment" : "Post"} by {r.reported_author_id ? names.get(r.reported_author_id) ?? "a member" : "a former member"}
                {contentGone ? " (already removed)" : ""}
              </p>
              <p className="mt-1 text-chalk whitespace-pre-line break-words">{r.content_excerpt || "(no text)"}</p>
              <p className="mt-1 text-xs text-steel">Why: {r.reason}</p>
              <ReportedItemActions reportId={r.id} isComment={r.content_kind === "comment"} contentGone={contentGone} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
