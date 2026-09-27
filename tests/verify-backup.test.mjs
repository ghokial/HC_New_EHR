import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/verify-backup.mjs", import.meta.url));

async function migrationTables() {
  const dir = new URL("../supabase/migrations/", import.meta.url), tables = new Set();
  for (const name of (await readdir(dir)).filter(n => n.endsWith(".sql"))) {
    const sql = await readFile(new URL(name, dir), "utf8");
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)/gi)) tables.add(m[1].toLowerCase());
    for (const m of sql.matchAll(/drop table (?:if exists )?public\.([a-z0-9_]+)/gi)) tables.delete(m[1].toLowerCase());
  }
  return [...tables];
}

test("the backup checker accepts a complete dump and rejects one missing tables or data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hc-backup-"));
  try {
    const tables = await migrationTables();
    await writeFile(join(dir, "roles.sql"), "CREATE ROLE example;\n");
    await writeFile(join(dir, "schema.sql"), tables.map(t => `CREATE TABLE "public"."${t}" (\n id int\n);`).join("\n"));
    await writeFile(join(dir, "data.sql"), ["facilities", "facility_memberships", "patients", "encounters", "audit_logs"].map(t => `COPY "public"."${t}" (id) FROM stdin;\n\\.`).join("\n"));
    const ok = await run(process.execPath, [script, dir]);
    assert.match(ok.stdout, /Backup looks complete/);
    assert.equal(Object.keys(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")).sha256).length, 3);

    await writeFile(join(dir, "schema.sql"), tables.slice(1).map(t => `CREATE TABLE "public"."${t}" (id int);`).join("\n"));
    await writeFile(join(dir, "data.sql"), `COPY "public"."facilities" (id) FROM stdin;\n\\.`);
    const bad = await run(process.execPath, [script, dir]).then(() => null, error => error);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, new RegExp(`lacks 1 table\\(s\\): ${tables[0]}`));
    assert.match(bad.stderr, /no rows for public\.patients/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
