import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { duplicateProgram } from "@/lib/program-duplication";

// Package-Program Linking (package_program_linking_scoping.md) — the
// manual/comped enrollment path. package-assignment-control.tsx used to
// insert package_assignments directly via RLS (no server route needed,
// since that table has no Stripe side effect) — but a package with a
// linked program needs duplicateProgram() to actually run, which is a
// real TypeScript function, not something a database trigger can call.
// This route is the one exception to that direct-write convention, for
// exactly that reason.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { packageId, athleteId } = await request.json();
  if (!packageId || !athleteId) {
    return NextResponse.json({ error: "Missing packageId or athleteId." }, { status: 400 });
  }

  const { data: pkg } = await supabase
    .from("coach_packages")
    .select("id, group_id, default_program_id")
    .eq("id", packageId)
    .maybeSingle();
  if (!pkg) return NextResponse.json({ error: "Package not found." }, { status: 404 });

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", pkg.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Only a coach of this group can assign packages." }, { status: 403 });
  }

  const { data: existingAssignment } = await supabase
    .from("package_assignments")
    .select("id")
    .eq("coach_package_id", packageId)
    .eq("athlete_id", athleteId)
    .maybeSingle();

  if (!existingAssignment) {
    const { error: insertError } = await supabase
      .from("package_assignments")
      .insert({ coach_package_id: packageId, athlete_id: athleteId });
    if (insertError) return NextResponse.json({ error: "Couldn't assign this package." }, { status: 502 });
  }

  let programResult: { programId: string } | null = null;
  if (pkg.default_program_id) {
    const result = await duplicateProgram(supabase, {
      sourceProgramId: pkg.default_program_id,
      destinationGroupId: pkg.group_id,
      createdBy: user.id,
      athleteId,
    });
    if ("error" in result) {
      // The credit-granting assignment already succeeded above — a
      // failed program copy is a real, separate problem worth surfacing,
      // not a reason to roll back the assignment itself.
      return NextResponse.json({ ok: true, programError: result.error });
    }
    programResult = result;
  }

  return NextResponse.json({ ok: true, programId: programResult?.programId ?? null });
}
