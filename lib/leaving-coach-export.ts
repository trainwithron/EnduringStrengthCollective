import { exportEntries } from "@/lib/business-export";
import { zipStream } from "@/lib/zip-store";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { runPool } from "@/lib/run-pool";
import { pageAll } from "@/lib/page-all";

// The one export a coach is owed when their coaching access ends. It is made ONCE, at that moment, and kept in a private bucket (migration 0396: no policies, only the server key reaches it), so what the coach
// can download never changes afterwards: not with the gym's new notes, not with clients who joined later. The coach reaches it through app/api/coach/exit-export, which checks who they are and that the 30 days
// have not passed, and hands out a short-lived link.
export const EXIT_EXPORT_BUCKET = "coach-exit-exports";
// The zip is held in memory twice while it is stored (the pieces, then the file), inside a function with about a gigabyte: 150 MB keeps that well inside it. A bigger export is not stored; the link then falls
// back to the live read in app/api/coach/exit-export (a download that is streamed and never held in memory).
export const MAX_EXPORT_BYTES = 150 * 1024 * 1024;

// The clients' sign-in emails for the export, looked up with the server key for clients already read.
// A lookup that fails is reported (it throws, which the export records as "clients (emails)" and the store counts as a failed try): the contact emails are the main thing a coach takes with them, so a blank cell
// from a failed lookup must never be kept as the final export. A client whose account no longer exists simply has no email.
export const emailsForExport = (db: any) => async (ids: string[]) => {
  const found = new Map<string, string>();
  const run = await runPool(ids, 8, async (id) => {
    const { data, error } = await db.auth.admin.getUserById(id);
    if (error && !(error.status === 404 || /not found/i.test(String(error.message ?? "")))) throw new Error("lookup failed");
    const email = data?.user?.email;
    if (email && !isPlaceholderEmail(email)) found.set(id, email);
  });
  if (run.failed.length > 0 || run.notStarted.length > 0) throw new Error("some emails could not be looked up");
  return found;
};

export const exportFileName = (orgName: string, on: Date = new Date()): string => {
  const safe = orgName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "my-business";
  return `${safe}-export-${on.toISOString().slice(0, 10)}.zip`;
};

// Removes stored files that no membership row points at any more (a platform administrator lifted the block and the coach started their own account, or a run died between storing and recording). A file made in the
// last hour is left alone: it may be mid-way through being recorded. Returns how many were removed.
export async function sweepOrphanExports(db: any): Promise<number> {
  try {
    // Which files are recorded: read in pages, and if that read failed or may be cut short nothing at all is deleted (a file that looks unrecorded might simply be one we did not see).
    const recorded = await pageAll((from, to) => db.from("organization_memberships").select("export_path, profile_id").not("export_path", "is", null).order("profile_id").range(from, to), { maxPages: 100 });
    if (recorded.failed || recorded.truncated) return 0;
    const known = new Set((recorded.rows as { export_path: string }[]).map((r) => r.export_path));
    const { data: folders } = await db.storage.from(EXIT_EXPORT_BUCKET).list("", { limit: 200 });
    const cutoff = Date.now() - 3600_000;
    let removed = 0;
    for (const folder of (folders ?? []) as { name: string; id: string | null }[]) {
      if (folder.id) continue; // a file at the top, not a folder
      const { data: files } = await db.storage.from(EXIT_EXPORT_BUCKET).list(folder.name, { limit: 200 });
      const orphans = ((files ?? []) as { name: string; created_at?: string }[]).filter((f) => !known.has(`${folder.name}/${f.name}`) && (!!f.created_at && new Date(f.created_at).getTime() < cutoff)).map((f) => `${folder.name}/${f.name}`);
      if (orphans.length > 0) {
        const { error } = await db.storage.from(EXIT_EXPORT_BUCKET).remove(orphans);
        if (!error) removed += orphans.length;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

// Builds the zip for the groups the coach kept and stores it. Returns the stored path, or null when it could not be made (the caller tries again on its next run).
export async function storeExitExport(db: any, args: { coachId: string; organizationId: string; groupIds: string[]; orgName: string }): Promise<string | null> {
  try {
    const report = { failed: [] as string[] };
    const reader = zipStream(exportEntries({ supabase: db, groupIds: args.groupIds, orgName: args.orgName, emailsFor: emailsForExport(db), report })).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        size += value.byteLength;
        if (size > MAX_EXPORT_BYTES) throw new Error("export is too large to store");
        chunks.push(value);
      }
    }
    // Only a COMPLETE export is kept as the coach's final one: a part that could not be read counts as a failed try (the next run tries again).
    if (report.failed.length > 0) {
      console.error("[leaving-coach] the export was incomplete (" + report.failed.join(", ") + "), so it was not stored");
      return null;
    }
    const path = `${args.coachId}/${args.organizationId}.zip`;
    const { error } = await db.storage.from(EXIT_EXPORT_BUCKET).upload(path, new Blob(chunks as BlobPart[], { type: "application/zip" }), { contentType: "application/zip", upsert: true });
    if (error) {
      console.error("[leaving-coach] could not store the export:", error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.error("[leaving-coach] could not make the export:", e instanceof Error ? e.message : e);
    return null;
  }
}
