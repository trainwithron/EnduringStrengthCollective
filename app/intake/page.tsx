import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { IntakeForm } from "@/components/intake/intake-form";

export default async function IntakePage(
  props: { searchParams: Promise<{ next?: string }> }
) {
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "athlete")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    // Nothing to gate — a coach or an account with no athlete membership
    // has no reason to be on this page at all.
    redirect("/");
  }

  const { data: group } = await supabase
    .from("groups")
    .select("organization_id")
    .eq("id", membership.group_id)
    .maybeSingle();

  const { data: org } = group?.organization_id
    ? await supabase
        .from("organizations")
        .select("name, waiver_text, waiver_pdf_path")
        .eq("id", group.organization_id)
        .maybeSingle()
    : { data: null };

  let waiverPdfUrl: string | null = null;
  if (org?.waiver_pdf_path) {
    const { data } = await supabase.storage
      .from("waiver-documents")
      .createSignedUrl(org.waiver_pdf_path, 3600);
    waiverPdfUrl = data?.signedUrl ?? null;
  }

  const { data: existing } = await supabase
    .from("client_intake")
    .select("par_q_answers, waiver_accepted, waiver_signed_name, completed_at")
    .eq("athlete_id", user.id)
    .maybeSingle();

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-10">
      <div className="max-w-lg mx-auto">
        <h1 className="font-display font-bold text-3xl uppercase leading-none mb-2">
          Before you get started
        </h1>
        <p className="font-body text-sm text-steel mb-8">
          {org?.name ?? "Your coach"} needs a quick health screening and waiver on file before
          you can access your program.
        </p>

        <IntakeForm
          groupId={membership.group_id}
          orgName={org?.name ?? null}
          waiverText={org?.waiver_text ?? null}
          waiverPdfUrl={waiverPdfUrl}
          nextUrl={searchParams.next ?? `/groups/${membership.group_id}`}
          initialParQAnswers={(existing?.par_q_answers as { question: string; answer: boolean }[]) ?? []}
          initialWaiverAccepted={existing?.waiver_accepted ?? false}
          initialWaiverSignedName={existing?.waiver_signed_name ?? ""}
          alreadyCompleted={!!existing?.completed_at}
        />
      </div>
    </main>
  );
}
