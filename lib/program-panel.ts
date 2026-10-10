// What the side panel's Program tab shows: a short list of the coach's active programs, one tap to open each. Inside a client's profile that client's own programs come first
// (active first), then the coach's other programs. An unsigned AI draft is listed too, marked, so it is not forgotten. Pure; no database.

export interface PanelProgramRow {
  id: string;
  name: string;
  groupId: string;
  athleteId: string | null;
  // The client this program was made for, or null for a shared / template program.
  clientName: string | null;
  isActive: boolean;
  aiDraft: boolean;
  createdAt: string;
}

export interface PanelPrograms {
  // The client whose profile the coach is in: their programs, active first. Empty outside a client's profile.
  forClient: PanelProgramRow[];
  // The coach's other active programs and unsigned drafts (newest first), at most OTHERS_SHOWN.
  others: PanelProgramRow[];
  // How many more there are than are shown (the link to the full Programs page covers them).
  moreCount: number;
}

export const OTHERS_SHOWN = 8;
export const CLIENT_SHOWN = 6;

const newestFirst = (a: PanelProgramRow, b: PanelProgramRow) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name);

export function panelPrograms(rows: PanelProgramRow[], clientId: string | null, orgGroupIds: string[] | null): PanelPrograms {
  const inOrg = (r: PanelProgramRow) => !orgGroupIds || orgGroupIds.includes(r.groupId);
  const scoped = rows.filter(inOrg);

  const forClient = clientId
    ? scoped
        .filter((r) => r.athleteId === clientId)
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || newestFirst(a, b))
        .slice(0, CLIENT_SHOWN)
    : [];

  const shownIds = new Set(forClient.map((r) => r.id));
  const others = scoped.filter((r) => !shownIds.has(r.id) && (!clientId || r.athleteId !== clientId) && (r.isActive || r.aiDraft)).sort(newestFirst);
  return { forClient, others: others.slice(0, OTHERS_SHOWN), moreCount: Math.max(0, others.length - OTHERS_SHOWN) };
}

// "Who it is for", under the program's name.
export function panelProgramLabel(r: Pick<PanelProgramRow, "clientName" | "isActive" | "aiDraft">): string {
  if (r.aiDraft) return r.clientName ? `AI draft · ${r.clientName}` : "AI draft";
  const base = r.clientName ?? "Shared";
  return r.isActive ? base : `${base} · not active`;
}

// The client whose profile the coach is in, read from the address: /groups/<group>/athletes/<client>.
export function clientIdFromPath(pathname: string | null): string | null {
  const m = /^\/groups\/[^/]+\/athletes\/([^/?#]+)/.exec(pathname ?? "");
  return m ? m[1] : null;
}
