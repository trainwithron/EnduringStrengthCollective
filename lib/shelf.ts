// The one product shelf. A coach's packages (sessions, a program, group access) and Pro Shop link cards (Printful, a supplement store) are placed in three places (the public page, the client's Home, the
// Pro Shop) and shown inside the app to an audience. Pure rules, so each is tested. Nothing here moves money: a Buy button is drawn only when the coach's Stripe Connect is finished AND the checkout that
// pays the coach exists, so no one ever meets a dead Buy.

export type Audience = "everyone" | "not_one_on_one" | "only_one_on_one" | "one_group";

export const AUDIENCES: { value: Audience; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "not_one_on_one", label: "Not my one-on-one clients" },
  { value: "only_one_on_one", label: "Only my one-on-one clients" },
  { value: "one_group", label: "One group" },
];

export function isAudience(v: unknown): v is Audience {
  return v === "everyone" || v === "not_one_on_one" || v === "only_one_on_one" || v === "one_group";
}

export interface ShelfViewer {
  // The coach looking at their own shelf (a preview) sees everything.
  isCoach: boolean;
  // The client's space with this coach is a one-on-one space.
  oneOnOne: boolean;
  // Every group the viewer belongs to (for "one group").
  groupIds: string[];
  // Known to be under 18 (an unknown date of birth counts as an adult, as everywhere else).
  isMinor: boolean;
}

// Whether someone inside the app is in the audience. The public page does not use this: it shows only "everyone".
export function audienceAllows(audience: Audience, audienceGroupId: string | null, viewer: ShelfViewer): boolean {
  if (viewer.isCoach) return true;
  switch (audience) {
    case "everyone":
      return true;
    case "not_one_on_one":
      return !viewer.oneOnOne;
    case "only_one_on_one":
      return viewer.oneOnOne;
    case "one_group":
      return !!audienceGroupId && viewer.groupIds.includes(audienceGroupId);
  }
}

export interface ShelfLink {
  category: string;
  audience?: string | null;
  audienceGroupId?: string | null;
  showOnPublic?: boolean;
}

// A client known to be under 18 is not shown supplements.
export function hiddenFromMinor(link: { category: string }): boolean {
  return link.category === "supplements";
}

// The link cards a signed-in viewer sees (Home and Pro Shop).
export function linksForViewer<T extends ShelfLink>(links: T[], viewer: ShelfViewer): T[] {
  return links.filter((l) => {
    const audience: Audience = isAudience(l.audience) ? l.audience : "everyone";
    if (!audienceAllows(audience, l.audienceGroupId ?? null, viewer)) return false;
    if (viewer.isMinor && !viewer.isCoach && hiddenFromMinor(l)) return false;
    return true;
  });
}

// The link cards on the public page: the ones the coach marked public AND open to everyone (a card meant for one group or the one-on-one clients is never shown to a stranger).
export function linksForPublic<T extends ShelfLink>(links: T[]): T[] {
  return links.filter((l) => l.showOnPublic === true && (l.audience ?? "everyone") === "everyone");
}

export type ProductKind = "sessions" | "program" | "group_access";

export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = { sessions: "Sessions", program: "Program", group_access: "Group access" };

// What a package is, from what it has attached: a program, a group, or just sessions.
export function productKind(p: { defaultProgramId?: string | null; groupAccessGroupId?: string | null }): ProductKind {
  if (p.defaultProgramId) return "program";
  if (p.groupAccessGroupId) return "group_access";
  return "sessions";
}

// Buy appears only for a coach whose Stripe Connect account is finished ("enabled") and only once the checkout that pays that coach exists. The second part is false until release R1, so in this release no
// Buy button is drawn anywhere; flipping CHECKOUT_PAYS_THE_COACH is the whole change once the checkout is built.
export const CHECKOUT_PAYS_THE_COACH = false;

export function buyEnabled(connectStatus: string | null | undefined): boolean {
  return CHECKOUT_PAYS_THE_COACH && connectStatus === "enabled";
}

// Shown beside Buy to someone who bought a program and so joins the coach's client space.
export function buyerMessageLine(coachFirstName: string): string {
  const name = coachFirstName.trim();
  return `You can message ${name || "your coach"}; replies aren't guaranteed.`;
}
