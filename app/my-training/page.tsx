import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { loadMyTraining } from "@/lib/my-training";
import { parseLastGroupCookie } from "@/lib/start-group";

// "My training" / "Start your own workout": the person's own client app, with no group to pick first (the rule is in lib/my-training.ts). One group holds my program(s): straight in.
// Several: the list is of programs, not groups. Nothing yet: the group they would land in anyway, so a coach can assign themselves a program there.
export default async function MyTrainingPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const lastGroupId = parseLastGroupCookie((await cookies()).get("last_group")?.value);
  const { result } = await loadMyTraining(supabase, user.id, lastGroupId);

  if (result.kind === "open") redirect(`/my-training/open?group=${result.groupId}`);

  if (result.kind === "none") {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display font-bold text-2xl uppercase leading-tight">Nothing to train yet</p>
        <p className="font-body text-sm text-steel max-w-[34ch]">You are not in a group yet, so there is no program to run. Once you are in one, it will be here.</p>
        <Link href="/" className="font-body text-sm text-rust underline underline-offset-2">Back</Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-10">
      <div className="max-w-md mx-auto">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">My training</h1>
        <p className="font-body text-sm text-steel mt-2">Pick the program to run.</p>
        <ul className="mt-6 divide-y divide-steel/15 border-y border-steel/15">
          {result.programs.map((p) => (
            <li key={p.programId}>
              <Link href={`/my-training/open?group=${p.groupId}`} className="block py-3.5 active:bg-surface/60">
                <span className="block font-body text-base text-chalk">{p.programName}</span>
                <span className="block font-body text-xs text-steel mt-0.5">{p.groupName}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
