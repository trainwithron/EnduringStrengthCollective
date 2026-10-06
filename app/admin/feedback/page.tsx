import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

// The platform admin's list of what testers wrote, newest first, with the page and device each came from.
export default async function AdminFeedbackPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle();
  if (!me?.is_platform_admin) {
    return (
      <NoAccess>You don&apos;t have access to this page.</NoAccess>
    );
  }

  const { data: rows, error } = await supabase
    .from("feedback_reports")
    .select("id, kind, message, page_path, user_agent, viewport, status, created_at, profiles ( full_name )")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-8 md:px-10">
      <Link href="/dashboard" className="font-body text-xs text-steel uppercase tracking-wide">
        &larr; Home
      </Link>
      <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">Feedback</h1>
      {error ? (
        <p className="font-body text-sm text-steel mt-6">The feedback table isn&apos;t set up yet.</p>
      ) : (rows ?? []).length === 0 ? (
        <p className="font-body text-sm text-steel mt-6">Nothing yet.</p>
      ) : (
        <ul className="mt-6 max-w-3xl divide-y divide-steel/15">
          {(rows ?? []).map((r: any) => (
            <li key={r.id} className="py-4">
              <p className="font-body text-xs text-steel uppercase tracking-wide">
                {r.kind === "idea" ? "Idea" : "Problem"} · {r.profiles?.full_name ?? "Unknown"} ·{" "}
                {new Date(r.created_at).toLocaleString()}
              </p>
              <p className="font-body text-[15px] mt-1 whitespace-pre-wrap">{r.message}</p>
              <p className="font-body text-xs text-steel mt-2 break-all">
                {r.page_path ?? "unknown page"} · {r.viewport ?? "?"} · {r.user_agent}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
