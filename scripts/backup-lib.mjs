// The pure parts of scripts/backup.mjs: choosing what to keep and what to download. No network and no disk, so they can be tested.

// Backup folders are named YYYY-MM-DD (or YYYY-MM-DDTHHMM). Returns the ones to delete so that only the newest `keep` remain.
// Anything that does not look like a backup folder is never touched.
export function foldersToDelete(names, keep) {
  const backups = names.filter((n) => /^\d{4}-\d{2}-\d{2}(T\d{4})?$/.test(n)).sort();
  if (keep < 1) return [];
  return backups.slice(0, Math.max(0, backups.length - keep));
}

// A storage object is downloaded unless a file of the same size is already there (a repeat run only fetches what is new or changed).
export function shouldDownload(existingSize, objectSize) {
  if (existingSize === null || existingSize === undefined) return true;
  if (objectSize === null || objectSize === undefined) return true;
  return existingSize !== objectSize;
}

// The Storage API lists one folder level at a time. An entry with no id and no metadata is a folder to open; anything else is a file.
export function splitStorageEntries(entries, prefix) {
  const files = [];
  const folders = [];
  for (const e of entries ?? []) {
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.id === null || e.id === undefined) folders.push(path);
    else files.push({ path, size: e.metadata?.size ?? e.metadata?.contentLength ?? null });
  }
  return { files, folders };
}

// Stamp for a backup folder name, in UTC.
export function backupFolderName(now) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}`;
}

// Keeps a storage path inside the backup folder: no absolute paths, no ".." climbing out.
export function safeRelativePath(p) {
  const parts = String(p).split("/").filter((s) => s && s !== "." && s !== "..");
  return parts.join("/");
}
