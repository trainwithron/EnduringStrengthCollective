import { createServerClient } from "@/lib/supabase/server";
import { InviteJoinFlow } from "@/components/invite/invite-join-flow";

export default async function InvitePage({
  params,
}: {
  params: { code: string };
}) {
  const supabase = createServerClient();

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
            This invite link is invalid or has expired. Ask your coach for a new one.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <InviteJoinFlow
        code={params.code}
        groupId={data.group_id}
        groupName={data.group_name}
      />
    </main>
  );
}
