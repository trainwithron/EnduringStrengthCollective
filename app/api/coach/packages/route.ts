import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";

// Package create/edit/delete has a real Stripe side effect (a Product +
// Price per package), so this can't be a plain client-side
// supabase.from("coach_packages").insert() the way most coach-config
// tables work — it needs a server route that holds the Stripe secret key.
// The authenticated createServerClient() does the ownership check;
// createServiceRoleClient() does the actual DB write (same split already
// used by app/api/stripe/checkout/route.ts).

async function requireCoachOfGroup(groupId: string) {
  const supabase = createServerClient();
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

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Payments aren't configured yet — ask your admin to add a STRIPE_SECRET_KEY." },
      { status: 503 }
    );
  }

  const body = await request.json();
  const { groupId, name, sessionsPerWeek, billingType, sessionsGranted, rateCents } = body;

  if (
    !groupId ||
    typeof name !== "string" ||
    !name.trim() ||
    !Number.isInteger(sessionsPerWeek) ||
    sessionsPerWeek <= 0 ||
    (billingType !== "subscription" && billingType !== "one_time") ||
    !Number.isInteger(sessionsGranted) ||
    sessionsGranted <= 0 ||
    !Number.isInteger(rateCents) ||
    rateCents <= 0
  ) {
    return NextResponse.json({ error: "Missing or invalid package fields." }, { status: 400 });
  }

  const authCheck = await requireCoachOfGroup(groupId);
  if ("error" in authCheck) return authCheck.error;

  const serviceRole = createServiceRoleClient();

  // Insert first (without Stripe ids) to get a stable id before creating
  // the Stripe objects — avoids an orphaned Stripe Product/Price if the
  // DB insert itself fails.
  const { data: pkg, error: insertError } = await serviceRole
    .from("coach_packages")
    .insert({
      coach_id: authCheck.userId,
      group_id: groupId,
      name: name.trim(),
      sessions_per_week: sessionsPerWeek,
      billing_type: billingType,
      sessions_granted: sessionsGranted,
      rate_cents: rateCents,
    })
    .select("id")
    .single();

  if (insertError || !pkg) {
    return NextResponse.json({ error: "Couldn't create the package." }, { status: 502 });
  }

  try {
    const stripe = getStripeClient();
    const totalCents = rateCents * sessionsGranted;

    const product = await stripe.products.create({
      name: name.trim(),
      metadata: { coach_id: authCheck.userId, group_id: groupId, coach_package_id: pkg.id },
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: totalCents,
      recurring: billingType === "subscription" ? { interval: "month" } : undefined,
    });

    await serviceRole
      .from("coach_packages")
      .update({ stripe_product_id: product.id, stripe_price_id: price.id })
      .eq("id", pkg.id);

    return NextResponse.json({ packageId: pkg.id });
  } catch (err) {
    // The DB row exists but Stripe setup failed — deactivate it rather
    // than leave a package with no price that could otherwise be bought.
    await serviceRole.from("coach_packages").update({ is_active: false }).eq("id", pkg.id);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't set up billing for this package: ${message}` }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Payments aren't configured yet." }, { status: 503 });
  }

  const body = await request.json();
  const { packageId, groupId, name, sessionsPerWeek, billingType, sessionsGranted, rateCents, isActive } = body;
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

  try {
    const stripe = getStripeClient();

    if (priceAffectingChange && existing.stripe_product_id) {
      // Prices are immutable — archive the old one and mint a fresh
      // Product+Price rather than trying to mutate an amount in place.
      // Existing purchasers/subscribers keep referencing the old Price
      // until they resubscribe; that's expected, not a bug.
      if (existing.stripe_price_id) {
        await stripe.prices.update(existing.stripe_price_id, { active: false });
      }
      const finalName = (name ?? existing.name).trim();
      const finalRate = rateCents ?? existing.rate_cents;
      const finalSessions = sessionsGranted ?? existing.sessions_granted;
      const finalBillingType = billingType ?? existing.billing_type;

      const product = await stripe.products.create({
        name: finalName,
        metadata: { coach_id: authCheck.userId, group_id: groupId, coach_package_id: packageId },
      });
      const price = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: finalRate * finalSessions,
        recurring: finalBillingType === "subscription" ? { interval: "month" } : undefined,
      });
      updates.stripe_product_id = product.id;
      updates.stripe_price_id = price.id;
    } else if (name != null && existing.stripe_product_id) {
      await stripe.products.update(existing.stripe_product_id, { name: name.trim() });
    }

    if (isActive === false && existing.stripe_price_id && !priceAffectingChange) {
      await stripe.prices.update(existing.stripe_price_id, { active: false });
    }

    const { error: updateError } = await serviceRole.from("coach_packages").update(updates).eq("id", packageId);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
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
    .select("stripe_price_id")
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
      await getStripeClient().prices.update(existing.stripe_price_id, { active: false });
    } catch {
      // Best-effort — the package is already deactivated on our side,
      // which is what actually stops it from being sold; a stale active
      // Price in Stripe with no product-side path to it isn't harmful.
    }
  }

  return NextResponse.json({ ok: true });
}
