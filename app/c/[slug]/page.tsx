import { readRowsByIds } from "@/lib/read-by-ids";
import { pageAll } from "@/lib/page-all";
import { googleFontsHref } from "@/lib/google-fonts";
import { ShopCard } from "@/components/shared/shop-card";
import { isRealCoach } from "@/lib/real-coach";
import type { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { cleanParam } from "@/lib/public-booking-route";
import { canSignProofs } from "@/lib/public-booking-proof";
import { isEmailConfigured } from "@/lib/email";
import { requestTargetFor } from "@/lib/client-requests";
import { DEFAULT_ORG_THEME } from "@/lib/theme";
import { factsFromJson, ownImagePath, pickBrandOrg, reviewsFromJson, safeWebUrl, siteColors, cleanSite, type SiteBackground } from "@/lib/coach-site";

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
  // The coach's one switch (Calendar > Availability): off means the link shows a plain "not available" page, to everyone but the coach previewing it.
  if (!page.enabled && !isOwner) return null;

  const [{ data: profile }, { data: membership }] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", page.coach_id).maybeSingle(),
    db.from("organization_memberships").select("organization_id, role").eq("profile_id", page.coach_id).in("role", ["owner", "admin"]).limit(5),
  ]);
  // A coach in several organizations: one they own first, then the oldest (stable; see pickBrandOrg).
  const orgIds = (membership ?? []).map((m) => m.organization_id as string);
  const { data: orgRows } = orgIds.length > 0
    ? await db.from("organizations").select("id, created_at, name, accent_color, background_color, text_color, font_display, font_body, logo_url").in("id", orgIds)
    : { data: [] as any[] };
  const org = pickBrandOrg((membership ?? []) as { organization_id: string; role: string }[], (orgRows ?? []) as any[]);
  // The page belongs to that organization, so the packages and the shop on it are that organization's only.
  const orgGroupRows = org ? (await pageAll((from, to) => db.from("groups").select("id").eq("organization_id", org.id).order("id").range(from, to))).rows : ([] as { id: string }[]);
  const orgGroupIdList = orgGroupRows.map((g) => g.id as string);
  const [{ data: packages }, { data: shop }] = await Promise.all([
    readRowsByIds(orgGroupIdList, (g) => (from, to) =>
      db.from("coach_packages").select("id, name, sessions_per_week, billing_type, sessions_granted, rate_cents").eq("coach_id", page.coach_id).in("group_id", g).eq("is_active", true).eq("is_public", true).order("id").range(from, to)
    ).then((r) => ({ data: r.data.sort((a: any, b: any) => (a.sessions_per_week ?? 0) - (b.sessions_per_week ?? 0)).slice(0, 6) })),
    org
      ? db.from("pro_shop_links").select("id, title, description, url, image_url").eq("coach_id", page.coach_id).eq("organization_id", org.id).eq("show_on_public", true).eq("audience", "everyone").order("sort_order", { ascending: true }).limit(3)
      : Promise.resolve({ data: [] as { id: string; title: string; description: string | null; url: string; image_url: string | null }[] }),
  ]);

  const content = cleanSite({
    headline: site.headline ?? "",
    whoIHelp: site.who_i_help ?? "",
    whatIDo: site.what_i_do ?? "",
    whyLines: site.why_lines ?? [],
    reviews: reviewsFromJson(site.reviews),
    background: site.background as SiteBackground,
    eyebrow: site.eyebrow ?? "",
    facts: factsFromJson(site.facts),
    packagesNote: site.packages_note ?? "",
    tagline: site.tagline ?? "",
    consultNote: site.consult_note ?? "",
  });
  const brand = {
    backgroundColor: org?.background_color ?? DEFAULT_ORG_THEME.backgroundColor,
    textColor: org?.text_color ?? DEFAULT_ORG_THEME.textColor,
    accentColor: org?.accent_color ?? DEFAULT_ORG_THEME.accentColor,
  };
  const publicUrl = (path: string | null) => (path ? db.storage.from("coach-profile-photos").getPublicUrl(path).data.publicUrl : null);
  const canBook = !!page.enabled && canSignProofs() && isEmailConfigured();
  // "Request to train with me": only when the coach's page is on, the coach left the request switch on, and a request has an organization to go to (the same check the request itself makes).
  const canRequest = (await requestTargetFor(db, slug)) !== null;
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
    canRequest,
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
    // Shared by link, never harvested by search engines: every coach has this page now (made automatically), and a coach's name must not appear in search results just because they opened a tab.
    robots: { index: false, follow: false },
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
  const wrap = "max-w-5xl mx-auto px-5";
  const section = `${wrap} py-14 sm:py-20`;
  const line = { borderBottom: `1px solid ${c.card}` };
  const sectionTitle = "text-4xl sm:text-5xl font-bold uppercase leading-none mb-7";
  // The coach's name, with the last word in the accent (Oct 28 redesign: "COACH RON").
  const nameWords = d.coachName.trim().split(/\s+/);
  const nameLast = nameWords.length > 1 ? nameWords.pop() : null;
  const bookButton = d.canBook ? (
    <Link href={`/book/${d.slug}`} className="inline-flex items-center justify-center min-h-12 px-6 font-semibold text-base" style={{ background: c.accent, color: c.bg, border: `2px solid ${c.accent}` }}>
      Book a consultation
    </Link>
  ) : null;
  const requestButton = d.canRequest ? (
    <Link href={`/c/${d.slug}/request`} className="inline-flex items-center justify-center min-h-12 px-6 font-semibold text-base" style={d.canBook ? { border: `2px solid ${c.accent}`, color: c.text } : { background: c.accent, color: c.bg, border: `2px solid ${c.accent}` }}>
      Request to train with me
    </Link>
  ) : null;
  const hasButtons = !!(bookButton || requestButton);
  const priceOf = (p: (typeof d.packages)[number]) => ({ main: dollars(p.rate_cents * p.sessions_granted), unit: p.billing_type === "subscription" ? "a month" : "one time" });

  return (
    <main className={`min-h-screen ${hasButtons ? "pb-24 sm:pb-0" : ""}`} style={{ background: c.bg, color: c.text, fontFamily: `'${d.fontBody}', system-ui, sans-serif` }}>
      {/* This coach's own fonts: the layout loads only the visitor's, so a coach's public page asks for its own. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={googleFontsHref([d.fontDisplay, d.fontBody])} precedence="default" />
      {!d.published && (
        <p className="text-center text-sm py-2" style={{ background: "#F2C94C", color: "#1C1B1A" }}>
          Preview only. This page is not published yet.
        </p>
      )}

      {/* Header band (Oct 28 redesign): the cover photo fading into the page, or a plain textured band without one. */}
      <header className="relative overflow-hidden" style={line}>
        {d.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public Supabase Storage URL.
          <img src={d.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div aria-hidden="true" className="absolute inset-0" style={{ background: `repeating-linear-gradient(135deg, ${c.card} 0 2px, transparent 2px 14px)` }} />
        )}
        <div aria-hidden="true" className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 0%, ${c.bg}99 45%, ${c.bg} 100%)` }} />
        <div className={`${wrap} relative pt-16 sm:pt-28 pb-12 sm:pb-14`}>
          {d.logoUrl && (
            // The logo sits on a light chip so a dark logo still shows on a dark page.
            <div className="inline-flex items-center gap-2.5 py-2 pl-2.5 pr-3.5 mb-7" style={{ background: "#F2EEE6" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- public Supabase Storage URL. */}
              <img src={d.logoUrl} alt={d.orgName ?? ""} className="h-8 w-auto" />
              {d.orgName && (
                <span className="font-semibold uppercase tracking-wider text-sm" style={{ ...heading, color: "#111111" }}>
                  {d.orgName}
                </span>
              )}
            </div>
          )}
          {c2.eyebrow && (
            <p className="text-sm font-semibold uppercase tracking-[0.14em]" style={{ color: c.accent }}>
              {c2.eyebrow}
            </p>
          )}
          <h1 className="text-6xl sm:text-8xl font-bold uppercase leading-[0.95] mt-2 break-words" style={heading}>
            {nameWords.join(" ")}
            {nameLast && (
              <>
                {" "}
                <span style={{ color: c.accent }}>{nameLast}</span>
              </>
            )}
          </h1>
          {c2.headline && (
            <p className="text-lg sm:text-xl mt-4 max-w-[34ch]" style={{ color: c.muted }}>
              {c2.headline}
            </p>
          )}
          {hasButtons && (
            <div className="flex flex-wrap gap-3 mt-7">
              {bookButton}
              {requestButton}
            </div>
          )}
        </div>
      </header>

      {c2.facts.length > 0 && (
        <div style={line}>
          <div className={`${wrap} grid grid-cols-1 sm:grid-cols-3 sm:divide-x`} style={{ borderColor: c.card }}>
            {c2.facts.map((f, i) => (
              <div key={i} className="py-5 sm:px-5 sm:first:pl-0" style={{ borderColor: c.card }}>
                <p className="text-xl font-bold uppercase" style={{ ...heading, color: c.accent }}>
                  {f.title}
                </p>
                {f.line && (
                  <p className="text-sm" style={{ color: c.muted }}>
                    {f.line}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(c2.whoIHelp || c2.whatIDo) && (
        <div style={line}>
          <section className={`${section} grid gap-10 ${d.heroUrl ? "sm:grid-cols-[300px_1fr]" : ""} items-start`}>
            {d.heroUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- public Supabase Storage URL.
              <img src={d.heroUrl} alt={d.coachName} className="w-full max-w-[300px] aspect-[4/5] object-cover" />
            )}
            <div className="min-w-0">
              <h2 className={sectionTitle} style={heading}>
                About <span style={{ color: c.accent }}>me</span>
              </h2>
              {c2.whoIHelp && (
                <p className="text-lg leading-relaxed max-w-[60ch] mb-4">
                  <span className="font-semibold" style={{ color: c.accent }}>
                    Who I help.{" "}
                  </span>
                  {c2.whoIHelp}
                </p>
              )}
              {c2.whatIDo && (
                <p className="text-lg leading-relaxed max-w-[60ch]">
                  <span className="font-semibold" style={{ color: c.accent }}>
                    What I do.{" "}
                  </span>
                  {c2.whatIDo}
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {hasButtons && (
        <div style={line}>
          <section className={section}>
            <h2 className={sectionTitle} style={heading}>
              How it <span style={{ color: c.accent }}>works</span>
            </h2>
            <ol className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {HOW_IT_WORKS.map(([title, body], i) => (
                <li key={title} className="pt-4" style={{ borderTop: `3px solid ${c.accent}` }}>
                  <p className="text-sm tracking-widest uppercase" style={{ ...heading, color: c.accent }}>
                    Step {i + 1}
                  </p>
                  <h3 className="text-2xl font-bold uppercase mt-1 mb-2" style={heading}>
                    {title}
                  </h3>
                  <p style={{ color: c.muted }}>{body}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}

      {c2.whyLines.length > 0 && (
        <div style={line}>
          <section className={section}>
            <h2 className={sectionTitle} style={heading}>
              Why pick <span style={{ color: c.accent }}>me</span>
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-10">
              {c2.whyLines.map((l) => (
                <li key={l} className="flex gap-3.5 text-lg py-3.5" style={{ borderBottom: `1px solid ${c.card}` }}>
                  <span aria-hidden="true" className="shrink-0 w-2.5 h-2.5 mt-2.5" style={{ background: c.accent }} />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {hasButtons && (
        <div style={line}>
          <section className={`${section} grid gap-12 sm:grid-cols-[1fr_280px] items-center`}>
            <div className="min-w-0">
              <h2 className={sectionTitle} style={heading}>
                Your training, <span style={{ color: c.accent }}>in your pocket</span>
              </h2>
              <ul className="grid gap-4">
                {IN_THE_APP.map(([title, body]) => (
                  <li key={title}>
                    <p className="text-lg font-bold uppercase" style={heading}>
                      {title}
                    </p>
                    <p style={{ color: c.muted }}>{body}</p>
                  </li>
                ))}
              </ul>
            </div>
            {/* A drawn phone with an example workout: about the app, never a real client. */}
            <div aria-hidden="true" className="w-full max-w-[260px] mx-auto rounded-[34px] p-3.5" style={{ border: `2px solid ${c.card}` }}>
              <div className="rounded-[22px] p-4 flex flex-col gap-2.5 aspect-[9/17]" style={{ background: c.bg, border: `1px solid ${c.card}` }}>
                <p className="text-xl uppercase" style={heading}>
                  Today &middot; Lower
                </p>
                {EXAMPLE_WORKOUT.map(([name, sets]) => (
                  <div key={name} className="flex justify-between gap-2 p-2.5 text-[13px]" style={{ background: c.card }}>
                    <span>{name}</span>
                    <span className="font-semibold" style={{ color: c.accent }}>
                      {sets}
                    </span>
                  </div>
                ))}
                <div className="mt-auto text-center p-3 text-sm font-semibold" style={{ background: c.accent, color: c.bg }}>
                  Start workout
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {(d.packages.length > 0 || c2.packagesNote) && (
        <div style={line}>
          <section className={section}>
            <h2 className={sectionTitle} style={heading}>
              Programs and <span style={{ color: c.accent }}>packages</span>
            </h2>
            {d.packages.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {d.packages.map((p) => {
                  const price = priceOf(p);
                  return (
                    <div key={p.id} id={`package-${p.id}`} className="p-6 flex flex-col gap-2 scroll-mt-4" style={{ background: c.card }}>
                      <h3 className="text-2xl font-bold uppercase" style={heading}>
                        {p.name}
                      </h3>
                      <p className="text-sm" style={{ color: c.muted }}>
                        {p.sessions_per_week}x a week &middot; {p.billing_type === "subscription" ? "monthly" : "one time"}
                      </p>
                      {d.showPrices && (
                        <p className="mt-auto pt-3 text-4xl tabular-nums" style={{ ...heading, color: c.accent }}>
                          {price.main}{" "}
                          <span className="text-sm" style={{ color: c.muted }}>
                            {price.unit}
                          </span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {c2.packagesNote && (
              <p className="mt-5 max-w-[65ch]" style={{ color: c.muted }}>
                {c2.packagesNote}
              </p>
            )}
            {bookButton && d.packages.length > 0 && (
              <p className="text-sm mt-3" style={{ color: c.muted }}>
                Book a consultation to find the right fit.
              </p>
            )}
          </section>
        </div>
      )}

      {c2.reviews.length > 0 && (
        <div style={line}>
          <section className={section}>
            <h2 className={sectionTitle} style={heading}>
              What clients <span style={{ color: c.accent }}>say</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {c2.reviews.map((r, i) => (
                <figure key={i} className="pl-5" style={{ borderLeft: `3px solid ${c.accent}` }}>
                  <blockquote className="text-lg leading-relaxed">&ldquo;{r.quote}&rdquo;</blockquote>
                  {r.first_name && (
                    <figcaption className="text-sm mt-2" style={{ color: c.muted }}>
                      {r.first_name}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </section>
        </div>
      )}

      {d.shop.length > 0 && (
        <div style={line}>
          <section className={section}>
            <h2 className={sectionTitle} style={heading}>
              From the <span style={{ color: c.accent }}>shop</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {d.shop.map((s) => (
                <ShopCard
                  key={s.id}
                  title={s.title}
                  description={s.description}
                  imageUrl={s.image}
                  href={s.url as string}
                  colors={{ card: c.card, text: c.text, muted: c.muted, accent: c.accent, accentText: c.bg }}
                />
              ))}
            </div>
          </section>
        </div>
      )}

      {c2.tagline && (
        <div style={line}>
          <section className={`${section} text-center`}>
            <p className="text-3xl sm:text-4xl font-bold uppercase leading-tight max-w-[24ch] mx-auto" style={{ ...heading, color: c.muted }}>
              {c2.tagline}
            </p>
          </section>
        </div>
      )}

      {hasButtons && (
        <section className={`${section} text-center`}>
          <h2 className={sectionTitle} style={heading}>
            Ready to <span style={{ color: c.accent }}>start?</span>
          </h2>
          {c2.consultNote && (
            <p className="-mt-3 mb-6" style={{ color: c.muted }}>
              {c2.consultNote}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            {bookButton}
            {requestButton}
          </div>
        </section>
      )}

      {/* On a phone the two buttons stay at the bottom of the screen. */}
      {hasButtons && (
        <div className="sm:hidden fixed inset-x-0 bottom-0 z-10 flex gap-2 px-3 pt-2.5" style={{ background: c.bg, borderTop: `1px solid ${c.card}`, paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))" }}>
          {d.canBook && (
            <Link href={`/book/${d.slug}`} className="flex-1 inline-flex items-center justify-center min-h-12 px-3 font-semibold text-[15px]" style={{ background: c.accent, color: c.bg }}>
              Book a consultation
            </Link>
          )}
          {d.canRequest && (
            <Link href={`/c/${d.slug}/request`} className="flex-1 inline-flex items-center justify-center min-h-12 px-3 font-semibold text-[15px]" style={d.canBook ? { border: `2px solid ${c.accent}`, color: c.text } : { background: c.accent, color: c.bg }}>
              {d.canBook ? "Request" : "Request to train with me"}
            </Link>
          )}
        </div>
      )}
    </main>
  );
}

// Fixed wording for every coach's page (Oct 28 redesign, Ron approved the mockup). About how coaching in the app works, never about a client.
const HOW_IT_WORKS: [string, string][] = [
  ["Book a consultation", "Pick a time on my calendar. We talk about your goals, history and schedule."],
  ["Get your program", "I build your plan and it shows up in the app on your phone, ready to start."],
  ["Train and check in", "Log each workout, send me questions, and I adjust as you go."],
];
const IN_THE_APP: [string, string][] = [
  ["Today's workout", "Sets, reps and weights ready when you walk in, with demo videos."],
  ["Log as you go", "Tap through your sets. Your progress and personal records track themselves."],
  ["Nutrition", "Simple food logging with targets set for you."],
  ["Your coach, one tap away", "Messages, check-ins and booking all in the same place."],
];
const EXAMPLE_WORKOUT: [string, string][] = [
  ["Back Squat", "4 x 5"],
  ["Romanian Deadlift", "3 x 8"],
  ["Walking Lunge", "3 x 10"],
  ["Suitcase Carry", "3 x 40 yd"],
];
