import { createServerClient } from "@/lib/supabase/server";
import { ReportedItemActions } from "./reported-item-actions";

interface ReportRow {
  id: string;
  reason: string;
  created_at: string;
  post_id: string | null;
  comment_id: string | null;
  reported_author_id: string | null;
  posts: { body: string | null } | null;
  comments: { body: string | null } | null;
}

// For a coach: the open reports in this group's feed, newest first, with what was reported, why, and the two things a coach can do. The reporter is not named (the coach needs the content and the reason, not a name to
// confront). Not shown when there is nothing open, or while the reports table is not there yet.
export async function ReportedContentPanel({ groupId }: { groupId: string }) {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("content_reports")
    .select("id, reason, created_at, post_id, comment_id, reported_author_id, posts ( body ), comments ( body )")
    .eq("group_id", groupId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(20);
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
  const authorIds = [...new Set(rows.map((r) => r.reported_author_id).filter((x): x is string => !!x))];
  const { data: people } = authorIds.length > 0 ? await supabase.from("profiles").select("id, full_name").in("id", authorIds) : { data: [] };
  const names = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "A member"]));

  return (
    <section aria-label="Reported posts" className="border border-rust/40 bg-rust/5 p-4 mb-6">
      <h2 className="font-display uppercase text-sm tracking-wide text-rust">Reported in this group ({rows.length})</h2>
      <ul className="mt-3 divide-y divide-steel/15">
        {rows.map((r) => (
          <li key={r.id} className="py-3 font-body text-sm">
            <p className="text-xs text-steel">
              {r.comment_id ? "Comment" : "Post"} by {r.reported_author_id ? names.get(r.reported_author_id) ?? "a member" : "a former member"}
            </p>
            <p className="mt-1 text-chalk whitespace-pre-line break-words">{(r.comment_id ? r.comments?.body : r.posts?.body) ?? "(no text)"}</p>
            <p className="mt-1 text-xs text-steel">Why: {r.reason}</p>
            <ReportedItemActions reportId={r.id} postId={r.post_id} commentId={r.comment_id} />
          </li>
        ))}
      </ul>
    </section>
  );
}
