import { exportEntries } from "@/lib/business-export";
import { zipStream } from "@/lib/zip-store";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { runPool } from "@/lib/run-pool";

// The one export a coach is owed when their coaching access ends. It is made ONCE, at that moment, and kept in a private bucket (migration 0396: no policies, only the server key reaches it), so what the coach
// can download never changes afterwards: not with the gym's new notes, not with clients who joined later. The coach reaches it through app/api/coach/exit-export, which checks who they are and that the 30 days
// have not passed, and hands out a short-lived link.
export const EXIT_EXPORT_BUCKET = "coach-exit-exports";
// The zip is held in memory twice while it is stored (the pieces, then the file), inside a function with about a gigabyte: 150 MB keeps that well inside it. A bigger export is not stored; the link then falls
// back to the live read in app/api/coach/exit-export (a download that is streamed and never held in memory).
export const MAX_EXPORT_BYTES = 150 * 1024 * 1024;

// The clients' sign-in emails for the export, looked up with the server key for clients already read.
export const emailsForExport = (db: any) => async (ids: string[]) => {
  const found = new Map<string, string>();
  await runPool(ids, 8, async (id) => {
    const { data } = await db.auth.admin.getUserById(id);
    const email = data?.user?.email;
    if (email && !isPlaceholderEmail(email)) found.set(id, email);
  });
  return found;
};

export const exportFileName = (orgName: string, on: Date = new Date()): string => {
  const safe = orgName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "my-business";
  return `${safe}-export-${on.toISOString().slice(0, 10)}.zip`;
};

// Builds the zip for the groups the coach kept and stores it. Returns the stored path, or null when it could not be made (the caller tries again on its next run).
export async function storeExitExport(db: any, args: { coachId: string; organizationId: string; groupIds: string[]; orgName: string }): Promise<string | null> {
  try {
    const reader = zipStream(exportEntries({ supabase: db, groupIds: args.groupIds, orgName: args.orgName, emailsFor: emailsForExport(db) })).getReader();
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
