import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { InviteJoinFlow } from "@/components/invite/invite-join-flow";

export default async function InvitePage(
  props: {
    params: Promise<{ code: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .rpc("get_invite_info", { _code: params.code })
    .maybeSingle<{
      group_id: string;
      group_name: string;
      role: "coach" | "athlete";
      valid: boolean;
    }>();

  if (error || !data || !data.valid) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 text-center">
        <div>
          <h1 className="font-display uppercase text-2xl font-bold">
            Invite not available
          </h1>
          <p className="font-body text-steel text-sm mt-2 max-w-sm">
            This invite link has expired, or someone has already used it. Ask your coach to send you a
            new link. If you already joined, sign in instead.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-11 px-6 mt-5 bg-rust text-graphite font-body text-sm font-medium"
          >
            Sign in
          </Link>
          <div className="mt-4">
            <Link href="/" className="font-body text-sm text-steel underline">
              Go to Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 relative">
      <Link href="/" className="absolute top-5 left-5 font-body text-xs text-steel uppercase tracking-wide">
        &larr; Home
      </Link>
      <InviteJoinFlow
        code={params.code}
        groupId={data.group_id}
        groupName={data.group_name}
      />
    </main>
  );
}
