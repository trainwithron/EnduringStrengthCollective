// Backs up the Supabase database and file storage to a folder on this machine.
//
//   node scripts/backup.mjs [--out <folder>] [--keep <n>] [--no-storage] [--schemas public,auth]
//
// What it does:
//   1. Dumps the database with pg_dump (custom format, no owners) into <out>/<date>/database.dump, then checks the dump can be
//      read back (pg_restore --list). Needs pg_dump and pg_restore installed and DATABASE_URL set to the project's connection
//      string (Supabase, Project Settings, Database, Connection string; use the direct or session pooler string).
//   2. Copies every storage bucket to <out>/storage/<bucket>/..., fetching only files that are new or changed since the last
//      run. Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The storage copy is shared across dates because
//      files rarely change; the database dump is per date.
//   3. Deletes dated folders beyond the newest --keep (default 14).
// It only reads from Supabase and writes to the out folder (default ./backups). It never changes the database. Exit code 1 if
// any step failed, so a scheduler can alert. See docs/RUNBOOK.md for how to schedule it and how to restore.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { backupFolderName, foldersToDelete, safeRelativePath, shouldDownload, splitStorageEntries } from "./backup-lib.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const outRoot = flag("--out", "backups");
const keep = Number(flag("--keep", "14"));
const schemas = (flag("--schemas", "public,auth") ?? "public,auth").split(",");
const skipStorage = args.includes("--no-storage");

const failures = [];
const folder = join(outRoot, backupFolderName(new Date()));
mkdirSync(folder, { recursive: true });

// ---- 1. database -----------------------------------------------------------------------------------------------------
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  failures.push("DATABASE_URL is not set, so the database was not backed up.");
} else {
  const dump = join(folder, "database.dump");
  const dumpArgs = ["--format=custom", "--no-owner", "--no-privileges", ...schemas.flatMap((s) => ["--schema", s]), "--file", dump, databaseUrl];
  const run = spawnSync("pg_dump", dumpArgs, { encoding: "utf8" });
  if (run.error || run.status !== 0) {
    failures.push(`pg_dump failed: ${run.error?.message ?? run.stderr?.trim() ?? run.status}`);
  } else {
    const check = spawnSync("pg_restore", ["--list", dump], { encoding: "utf8" });
    if (check.error || check.status !== 0) failures.push(`The dump was written but could not be read back: ${check.error?.message ?? check.stderr?.trim()}`);
    else console.log(`Database: ${(statSync(dump).size / 1048576).toFixed(1)} MB, ${check.stdout.split("\n").filter(Boolean).length} entries`);
  }
}

// ---- 2. storage ------------------------------------------------------------------------------------------------------
if (!skipStorage) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    failures.push("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set, so storage was not backed up.");
  } else {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    let downloaded = 0;
    let skipped = 0;
    try {
      const bucketsRes = await fetch(`${base}/storage/v1/bucket`, { headers });
      if (!bucketsRes.ok) throw new Error(`list buckets: ${bucketsRes.status}`);
      const buckets = await bucketsRes.json();

      async function walk(bucket, prefix) {
        let offset = 0;
        for (;;) {
          const res = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
          });
          if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status}`);
          const entries = await res.json();
          const { files, folders } = splitStorageEntries(entries, prefix);
          for (const f of files) {
            const target = join(outRoot, "storage", bucket, safeRelativePath(f.path));
            const existing = existsSync(target) ? statSync(target).size : null;
            if (!shouldDownload(existing, f.size)) {
              skipped++;
              continue;
            }
            const file = await fetch(`${base}/storage/v1/object/${bucket}/${f.path.split("/").map(encodeURIComponent).join("/")}`, { headers });
            if (!file.ok) throw new Error(`download ${bucket}/${f.path}: ${file.status}`);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, Buffer.from(await file.arrayBuffer()));
            downloaded++;
          }
          for (const sub of folders) await walk(bucket, sub);
          if (entries.length < 1000) break;
          offset += 1000;
        }
      }
      for (const b of buckets) await walk(b.name, "");
      console.log(`Storage: ${downloaded} files copied, ${skipped} already up to date, ${buckets.length} buckets`);
    } catch (err) {
      failures.push(`Storage copy failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ---- 3. retention ----------------------------------------------------------------------------------------------------
if (Number.isFinite(keep) && keep >= 1) {
  for (const old of foldersToDelete(readdirSync(outRoot), keep)) {
    rmSync(join(outRoot, old), { recursive: true, force: true });
    console.log(`Removed old backup ${old}`);
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAILED: ${f}`);
  process.exit(1);
}
console.log(`Backup complete: ${folder}`);
