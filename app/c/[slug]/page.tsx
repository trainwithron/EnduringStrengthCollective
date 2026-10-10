import { googleFontsHref } from "@/lib/google-fonts";
import { isRealCoach } from "@/lib/real-coach";
import type { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { cleanParam } from "@/lib/public-booking-route";
import { canSignProofs } from "@/lib/public-booking-proof";
import { isSendGridConfigured } from "@/lib/sendgrid";
import { DEFAULT_ORG_THEME } from "@/lib/theme";
import { ownImagePath, pickBrandOrg, reviewsFromJson, safeWebUrl, siteColors, cleanSite, type SiteBackground } from "@/lib/coach-site";

export const dynamic = "force-dynamic";

// A coach's one short public page. Public, no sign-in. It shows only what the coach typed, their public packages, their featured shop cards and their organization's branding: no client
// names or data, no trackers. Only a PUBLISHED page is shown (the owner can look at an unpublished one with ?preview=1 while signed in).

async function load(slugParam: string, preview: boolean) {
  const slug = cleanParam(slugParam.toLowerCase(), 40);
  if (!slug) return null;
  const db = createServiceRoleClient();
  const { data: page } = await db.from("coach_booking_pages").select("coach_id, slug, enabled, show_prices").eq("slug", slug).maybeSingle();
  if (!page) return null;
  if (!(await isRealCoach(db, page.coach_id))) return null;
  const { data: site } = await db.from("coach_sites").select("*").eq("coach_id", page.coach_id).maybeSingle();
  if (!site) return null;
  let isOwner = false;
  if (preview) {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isOwner = user?.id === page.coach_id;
  }
  if (!site.published && !isOwner) return null;

  const [{ data: profile }, { data: membership }, { data: packages }, { data: shop }] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", page.coach_id).maybeSingle(),
    db.from("organization_memberships").select("organization_id, role").eq("profile_id", page.coach_id).in("role", ["owner", "admin"]).limit(5),
    db.from("coach_packages").select("id, name, sessions_per_week, billing_type, sessions_granted, rate_cents").eq("coach_id", page.coach_id).eq("is_active", true).eq("is_public", true).order("sessions_per_week", { ascending: true }).limit(6),
    db.from("pro_shop_links").select("id, title, description, url, image_url").eq("coach_id", page.coach_id).eq("featured", true).order("sort_order", { ascending: true }).limit(3),
  ]);
  // A coach in several organizations: one they own first, then the oldest (stable; see pickBrandOrg).
  const orgIds = (membership ?? []).map((m) => m.organization_id as string);
  const { data: orgRows } = orgIds.length > 0
    ? await db.from("organizations").select("id, created_at, name, accent_color, background_color, text_color, font_display, font_body, logo_url").in("id", orgIds)
    : { data: [] as any[] };
  const org = pickBrandOrg((membership ?? []) as { organization_id: string; role: string }[], (orgRows ?? []) as any[]);

  const content = cleanSite({
    headline: site.headline ?? "",
    whoIHelp: site.who_i_help ?? "",
    whatIDo: site.what_i_do ?? "",
    whyLines: site.why_lines ?? [],
    reviews: reviewsFromJson(site.reviews),
    background: site.background as SiteBackground,
  });
  const brand = {
    backgroundColor: org?.background_color ?? DEFAULT_ORG_THEME.backgroundColor,
    textColor: org?.text_color ?? DEFAULT_ORG_THEME.textColor,
    accentColor: org?.accent_color ?? DEFAULT_ORG_THEME.accentColor,
  };
  const publicUrl = (path: string | null) => (path ? db.storage.from("coach-profile-photos").getPublicUrl(path).data.publicUrl : null);
  const canBook = !!page.enabled && canSignProofs() && isSendGridConfigured();
  return {
    slug,
    coachName: (profile?.full_name as string | null) ?? "Your coach",
    published: !!site.published,
    content,
    colors: siteColors(content.background, brand),
    fontDisplay: org?.font_display ?? DEFAULT_ORG_THEME.fontDisplay,
    fontBody: org?.font_body ?? DEFAULT_ORG_THEME.fontBody,
    logoUrl: safeWebUrl(org?.logo_url),
    orgName: (org?.name as string | null) ?? null,
    heroUrl: publicUrl(ownImagePath(site.hero_path, page.coach_id)),
    coverUrl: publicUrl(ownImagePath(site.cover_path, page.coach_id)),
    canBook,
    showPrices: !!page.show_prices,
    packages: (packages ?? []) as { id: string; name: string; sessions_per_week: number; billing_type: string; sessions_granted: number; rate_cents: number }[],
    shop: (shop ?? [])
      .map((s) => ({ id: s.id as string, title: s.title as string, description: (s.description as string | null) ?? null, url: safeWebUrl(s.url as string), image: safeWebUrl(s.image_url as string | null) }))
      .filter((s) => s.url),
  };
}

export async function generateMetadata(props: { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const { preview } = await props.searchParams;
  const data = await load(slug, preview === "1");
  if (!data) return { title: "Page not available", robots: { index: false, follow: false } };
  return {
    title: `${data.coachName}${data.orgName ? ` - ${data.orgName}` : ""}`,
    description: data.content.headline || `${data.coachName}, coaching.`,
    robots: data.published ? { index: true, follow: true } : { index: false, follow: false },
  };
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`;

export default async function CoachSitePage(props: { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { slug } = await props.params;
  const { preview } = await props.searchParams;
  const d = await load(slug, preview === "1");

  if (!d) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 text-center" style={{ background: "#F7F6F3", color: "#1C1B1A" }}>
        <div className="max-w-sm">
          <h1 className="text-2xl font-bold">This page isn&apos;t available</h1>
          <p className="text-sm mt-2" style={{ color: "#5F5B52" }}>
            The link may be wrong, or the page isn&apos;t published yet.
          </p>
        </div>
      </main>
    );
  }

  const c = d.colors;
  const c2 = d.content;
  const heading = { fontFamily: `'${d.fontDisplay}', system-ui, sans-serif` };
  const section = "max-w-2xl mx-auto px-5 py-8";
  const bookButton = d.canBook ? (
    <Link href={`/book/${d.slug}`} className="inline-flex items-center justify-center h-12 px-6 font-semibold text-base" style={{ background: c.accent, color: c.bg }}>
      Book a consultation
    </Link>
  ) : null;

  return (
    <main className="min-h-screen" style={{ background: c.bg, color: c.text, fontFamily: `'${d.fontBody}', system-ui, sans-serif` }}>
      {/* This coach's own fonts: the layout loads only the visitor's, so a coach's public page asks for its own. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={googleFontsHref([d.fontDisplay, d.fontBody])} precedence="default" />
      {!d.published && (
        <p className="text-center text-sm py-2" style={{ background: "#F2C94C", color: "#1C1B1A" }}>
          Preview only. This page is not published yet.
        </p>
      )}

      {d.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- public Supabase Storage URL.
        <img src={d.coverUrl} alt="" className="w-full h-40 sm:h-56 object-cover" />
      )}

      <header className={`${section} flex items-center gap-4`}>
        {d.heroUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- public Supabase Storage URL.
          <img src={d.heroUrl} alt={d.coachName} className="w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover shrink-0" />
        )}
        <div className="min-w-0">
          {d.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- public Supabase Storage URL.
            <img src={d.logoUrl} alt={d.orgName ?? ""} className="h-8 w-auto mb-2" />
          )}
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight uppercase" style={heading}>
            {d.coachName}
          </h1>
          {c2.headline && <p className="text-lg mt-1" style={{ color: c.muted }}>{c2.headline}</p>}
        </div>
      </header>

      {bookButton && <div className="max-w-2xl mx-auto px-5 pb-2">{bookButton}</div>}

      {(c2.whoIHelp || c2.whatIDo) && (
        <section className={section}>
          <h2 className="text-xl font-bold uppercase" style={heading}>About me</h2>
          {c2.whoIHelp && (
            <p className="mt-3 leading-relaxed">
              <span className="font-semibold">Who I help. </span>
              {c2.whoIHelp}
            </p>
          )}
          {c2.whatIDo && (
            <p className="mt-3 leading-relaxed">
              <span className="font-semibold">What I do. </span>
              {c2.whatIDo}
            </p>
          )}
        </section>
      )}

      {c2.whyLines.length > 0 && (
        <section className={section}>
          <h2 className="text-xl font-bold uppercase" style={heading}>Why pick me</h2>
          <ul className="mt-3 space-y-2">
            {c2.whyLines.map((line) => (
              <li key={line} className="flex gap-3">
                <span aria-hidden="true" style={{ color: c.accent }}>&#10003;</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c2.reviews.length > 0 && (
        <section className={section}>
          <h2 className="text-xl font-bold uppercase" style={heading}>What clients say</h2>
          <div className="mt-3 space-y-3">
            {c2.reviews.map((r, i) => (
              <figure key={i} className="p-4" style={{ background: c.card }}>
                <blockquote className="leading-relaxed">&ldquo;{r.quote}&rdquo;</blockquote>
                {r.first_name && <figcaption className="text-sm mt-2" style={{ color: c.muted }}>{r.first_name}</figcaption>}
              </figure>
            ))}
          </div>
        </section>
      )}

      {d.packages.length > 0 && (
        <section className={section}>
          <h2 className="text-xl font-bold uppercase" style={heading}>Programs and packages</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {d.packages.map((p) => (
              <div key={p.id} className="p-4" style={{ background: c.card }}>
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm mt-1" style={{ color: c.muted }}>
                  {p.sessions_per_week}x a week &middot; {p.billing_type === "subscription" ? "monthly" : "one time"}
                </p>
                {d.showPrices && <p className="mt-2 font-semibold">{dollars(p.rate_cents * p.sessions_granted)}{p.billing_type === "subscription" ? " a month" : ""}</p>}
              </div>
            ))}
          </div>
          {bookButton && <p className="text-sm mt-3" style={{ color: c.muted }}>Book a consultation to find the right fit.</p>}
        </section>
      )}

      {d.shop.length > 0 && (
        <section className={section}>
          <h2 className="text-xl font-bold uppercase" style={heading}>From the shop</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {d.shop.map((s) => (
              <a key={s.id} href={s.url as string} target="_blank" rel="noopener noreferrer" className="block p-3 min-h-11" style={{ background: c.card }}>
                {s.image && (
                  // eslint-disable-next-line @next/next/no-img-element -- outbound shop image chosen by the coach.
                  <img src={s.image} alt="" className="w-full h-28 object-cover mb-2" />
                )}
                <span className="font-semibold">{s.title}</span>
                {s.description && <span className="block text-sm mt-1" style={{ color: c.muted }}>{s.description}</span>}
              </a>
            ))}
          </div>
        </section>
      )}

      {bookButton && (
        <section className={`${section} text-center`}>
          <h2 className="text-xl font-bold uppercase" style={heading}>Ready to start?</h2>
          <div className="mt-4">{bookButton}</div>
        </section>
      )}
    </main>
  );
}
