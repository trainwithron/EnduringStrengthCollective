import { safeErrorDetail } from "@/lib/safe-error";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { programBelongsToCoach } from "@/lib/package-program-access";
import { groupBelongsToCoach } from "@/lib/package-group-access";

// Package edit/delete can touch Stripe, so this can't be a plain client-side
// supabase.from("coach_packages").insert() the way most coach-config
// tables work — it needs a server route that holds the Stripe secret key.
// A package's Product and Price live on the payee's own Stripe account and
// are made at checkout, the first time someone buys (lib/connect-payee.ts).
// The authenticated createServerClient() does the ownership check;
// createServiceRoleClient() does the actual DB write (same split already
// used by app/api/stripe/checkout/route.ts).

async function requireCoachOfGroup(groupId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) } as const;

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return { error: NextResponse.json({ error: "Only a coach of this group can manage packages." }, { status: 403 }) } as const;
  }
  return { userId: user.id } as const;
}

const KINDS = ["team", "program", "coaching", "sessions"];

export async function POST(request: Request) {
  const body = await request.json();
  const { groupId, name, sessionsPerWeek, billingType, sessionsGranted, rateCents, isPublic, defaultProgramId, groupAccessGroupId } = body;
  // The package builder (0440): the kind, one plain price, and for coaching how often check-ins are. A team, program or coaching package grants no sessions.
  const kind = KINDS.includes(body.kind) ? (body.kind as string) : null;
  const priceCents = Number.isInteger(body.priceCents) && body.priceCents > 0 ? (body.priceCents as number) : null;
  const checkinWeeks = [1, 2, 4].includes(body.checkinWeeks) ? (body.checkinWeeks as number) : null;

  if (
    !groupId ||
    typeof name !== "string" ||
    !name.trim() ||
    !Number.isInteger(sessionsPerWeek) ||
    sessionsPerWeek < 0 ||
    (billingType !== "subscription" && billingType !== "one_time") ||
    !Number.isInteger(sessionsGranted) ||
    sessionsGranted < 0 ||
    !Number.isInteger(rateCents) ||
    rateCents <= 0 ||
    (priceCents == null && sessionsGranted <= 0) ||
    (kind === "team" && !groupAccessGroupId) ||
    (kind === "program" && !defaultProgramId)
  ) {
    return NextResponse.json({ error: "Missing or invalid package fields." }, { status: 400 });
  }

  const authCheck = await requireCoachOfGroup(groupId);
  if ("error" in authCheck) return authCheck.error;

  const serviceRole = createServiceRoleClient();

  if (defaultProgramId && !(await programBelongsToCoach(serviceRole, authCheck.userId, defaultProgramId))) {
    return NextResponse.json({ error: "That program is not one of yours." }, { status: 400 });
  }

  if (groupAccessGroupId && !(await groupBelongsToCoach(serviceRole, authCheck.userId, groupAccessGroupId))) {
    return NextResponse.json({ error: "That group is not one of yours." }, { status: 400 });
  }

  // Defaults to private (is_public: false) —
  // matches the coach's own primary workflow (custom pricing assigned
  // per client) as the safer failure mode; a coach opts a package into
  // being an open menu explicitly.
  const { data: pkg, error: insertError } = await serviceRole
    .from("coach_packages")
    .insert({
      coach_id: authCheck.userId,
      group_id: groupId,
      name: name.trim(),
      sessions_per_week: sessionsPerWeek, billing_type: billingType,
      sessions_granted: sessionsGranted,
      rate_cents: rateCents,
      is_public: isPublic === true,
      default_program_id: defaultProgramId ?? null,
      group_access_group_id: groupAccessGroupId ?? null,
      ...(kind ? { kind } : {}), ...(priceCents ? { price_cents: priceCents } : {}), ...(checkinWeeks ? { checkin_weeks: checkinWeeks } : {}),
    })
    .select("id")
    .single();

  if (insertError || !pkg) {
    return NextResponse.json({ error: "Couldn't create the package." }, { status: 502 });
  }

  // Saving never touches Stripe: a package is real before payments are on or before the coach has connected (Ron, Nov 9), and can be assigned to clients by hand. Its price is made at checkout.
  return NextResponse.json({ packageId: pkg.id });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const { packageId, groupId, name, sessionsPerWeek, billingType, sessionsGranted, rateCents, isActive, isPublic, defaultProgramId, groupAccessGroupId } =
    body;
  if (!packageId || !groupId) {
    return NextResponse.json({ error: "Missing packageId or groupId." }, { status: 400 });
  }

  const authCheck = await requireCoachOfGroup(groupId);
  if ("error" in authCheck) return authCheck.error;

  const serviceRole = createServiceRoleClient();
  if (defaultProgramId && !(await programBelongsToCoach(serviceRole, authCheck.userId, defaultProgramId))) {
    return NextResponse.json({ error: "That program is not one of yours." }, { status: 400 });
  }
  if (groupAccessGroupId && !(await groupBelongsToCoach(serviceRole, authCheck.userId, groupAccessGroupId))) {
    return NextResponse.json({ error: "That group is not one of yours." }, { status: 400 });
  }
  const { data: existing } = await serviceRole
    .from("coach_packages")
    .select("*")
    .eq("id", packageId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Package not found." }, { status: 404 });
  }

  const priceAffectingChange =
    (rateCents != null && rateCents !== existing.rate_cents) ||
    (sessionsGranted != null && sessionsGranted !== existing.sessions_granted) ||
    (billingType != null && billingType !== existing.billing_type);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name != null) updates.name = name.trim();
  if (sessionsPerWeek != null) updates.sessions_per_week = sessionsPerWeek;
  if (sessionsGranted != null) updates.sessions_granted = sessionsGranted;
  if (rateCents != null) updates.rate_cents = rateCents;
  if (billingType != null) updates.billing_type = billingType;
  if (isActive != null) updates.is_active = isActive;
  if (isPublic != null) updates.is_public = isPublic;
  if (defaultProgramId !== undefined) updates.default_program_id = defaultProgramId;
  if (groupAccessGroupId !== undefined) updates.group_access_group_id = groupAccessGroupId;

  // Stripe is only actually touched for a price/name-affecting change or
  // a deactivation that archives a Price — a pure isPublic/isActive-true
  // toggle never needs it, so those keep working even with no
  // STRIPE_SECRET_KEY configured (like POST, which never needs Stripe).
  const needsStripe =
    (priceAffectingChange && existing.stripe_product_id) || (name != null && existing.stripe_product_id) || (isActive === false && existing.stripe_price_id);
  if (needsStripe && !isStripeConfigured()) {
    return NextResponse.json({ error: "Payments aren't configured yet." }, { status: 503 });
  }

  try {
    const stripe = needsStripe ? getStripeClient() : null;
    // Where this package's Stripe objects live: its coach's account, or the platform for one made before direct charges.
    const onAccount = existing.stripe_account_id ? { stripeAccount: existing.stripe_account_id as string } : undefined;

    if (stripe && priceAffectingChange && existing.stripe_product_id) {
      // Prices can't be changed. The old one is archived and a new one is made at the next checkout; existing subscribers stay on the old one.
      if (existing.stripe_price_id) {
        await stripe.prices.update(existing.stripe_price_id, { active: false }, onAccount);
      }
      updates.stripe_product_id = null;
      updates.stripe_price_id = null;
    } else if (stripe && name != null && existing.stripe_product_id) {
      await stripe.products.update(existing.stripe_product_id, { name: name.trim() }, onAccount);
    }

    if (stripe && isActive === false && existing.stripe_price_id && !priceAffectingChange) {
      await stripe.prices.update(existing.stripe_price_id, { active: false }, onAccount);
    }

    const { error: updateError } = await serviceRole.from("coach_packages").update(updates).eq("id", packageId);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = safeErrorDetail(err);
    return NextResponse.json({ error: `Couldn't update this package: ${message}` }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const { packageId, groupId } = await request.json();
  if (!packageId || !groupId) {
    return NextResponse.json({ error: "Missing packageId or groupId." }, { status: 400 });
  }

  const authCheck = await requireCoachOfGroup(groupId);
  if ("error" in authCheck) return authCheck.error;

  const serviceRole = createServiceRoleClient();
  const { data: existing } = await serviceRole
    .from("coach_packages")
    .select("*")
    .eq("id", packageId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Package not found." }, { status: 404 });
  }

  // Soft-delete only — never hard-delete once a package could have real
  // purchases pointing at it via coach_package_id.
  const { error: updateError } = await serviceRole
    .from("coach_packages")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", packageId);
  if (updateError) {
    return NextResponse.json({ error: "Couldn't deactivate this package." }, { status: 502 });
  }

  if (isStripeConfigured() && existing.stripe_price_id) {
    try {
      await getStripeClient().prices.update(existing.stripe_price_id, { active: false }, existing.stripe_account_id ? { stripeAccount: existing.stripe_account_id as string } : undefined);
    } catch {
      // Best-effort — the package is already deactivated on our side,
      // which is what actually stops it from being sold; a stale active
      // Price in Stripe with no product-side path to it isn't harmful.
    }
  }

  return NextResponse.json({ ok: true });
}
