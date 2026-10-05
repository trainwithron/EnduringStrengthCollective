// Compares the row-security policies of the rehearsal's live-equivalent schema with a snapshot of the live database
// (fixtures/live-policies.txt: table|policy|command|hash of the whitespace-stripped rule, read from pg_policies on 2026-10-05).
// Differences mean the repo's migrations and the live database have drifted, so a rehearsal result may not carry over.
//   node scripts/sql-tests/policy-drift.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDb, applyLiveEquivalent } from "./harness.mjs";

const db = await createDb();
await applyLiveEquivalent(db);
const rows = (await db.query(`select tablename, policyname, cmd, coalesce(qual,'') as q, coalesce(with_check,'') as w from pg_policies where schemaname = 'public'`)).rows;
const mine = new Map(rows.map((r) => [`${r.tablename}|${r.policyname}|${r.cmd}`, createHash("md5").update((r.q + "#" + r.w).replace(/\s+/g, "")).digest("hex").slice(0, 8)]));
const live = new Map(
  readFileSync(new URL("./fixtures/live-policies.txt", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const p = l.split("|");
      return [p.slice(0, 3).join("|"), p[3]];
    })
);

const onlyLive = [...live.keys()].filter((k) => !mine.has(k));
const onlyRepo = [...mine.keys()].filter((k) => !live.has(k));
const changed = [...live.keys()].filter((k) => mine.has(k) && mine.get(k) !== live.get(k));
console.log(`live ${live.size} policies, rehearsal ${mine.size}`);
console.log(`on live but not in the repo chain (${onlyLive.length}):\n  ${onlyLive.join("\n  ") || "-"}`);
console.log(`in the repo chain but not live (${onlyRepo.length}):\n  ${onlyRepo.join("\n  ") || "-"}`);
console.log(`same name, different rule text (${changed.length}; may be only deparse differences between Postgres versions):\n  ${changed.join("\n  ") || "-"}`);
