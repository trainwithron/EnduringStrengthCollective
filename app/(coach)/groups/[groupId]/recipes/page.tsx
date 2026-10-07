import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";

// The Recipe Hub is now the "Favorite meals" tab of Nutrition. Old links, bookmarks and Ask Spot answers keep working: a coach is sent to the tab.
export default async function RecipeHubPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return <NoAccess>Only coaches can manage favorite meals.</NoAccess>;
  }

  redirect(`/groups/${params.groupId}/nutrition?tab=favorites`);
}
