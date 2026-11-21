import Link from "next/link";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { BuiltinIngredientMappings } from "@/components/coach/desktop/builtin-ingredient-mappings";
import { loadBuiltinIngredientRows } from "@/lib/builtin-ingredient-rows";

export const metadata = { title: "Recipe ingredients" };

// The platform admin's mapping of the built-in recipes' shared ingredients to real USDA foods (so every client's Key nutrients can estimate micronutrients, not just macros). It is
// shared by every coach on the platform, so it lives here with the other admin tools, not on a coach's Nutrition page (Ron, Nov 21). Only the platform admin: checked here.
export default async function AdminNutritionIngredientsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle();
  if (!me?.is_platform_admin) return <NoAccess>You don&apos;t have access to this page.</NoAccess>;

  const rows = await loadBuiltinIngredientRows(supabase);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-4 py-8 md:px-10">
      <div className="flex flex-wrap items-center gap-x-5">
        <Link href="/dashboard" className="inline-flex items-center min-h-11 font-body text-xs text-steel uppercase tracking-wide">
          &larr; Home
        </Link>
        <Link href="/admin/machine-catalog" className="inline-flex items-center min-h-11 font-body text-xs text-steel uppercase tracking-wide">
          Machine requests
        </Link>
      </div>
      <h1 className="font-display font-bold text-3xl uppercase leading-none mt-1">Recipe ingredients</h1>
      <p className="font-body text-sm text-steel mt-2 mb-6 max-w-[65ch]">
        The built-in recipes&apos; shared ingredients, each mapped to a real USDA food so every client&apos;s Key nutrients can estimate micronutrients, not just macros. A change here applies
        to every coach on the platform.
      </p>
      <BuiltinIngredientMappings initialRows={rows} />
    </main>
  );
}
