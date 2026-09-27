// Checks a logical backup made with docs/operations/backup-and-restore.md before it is
// stored: the three files exist and are non-empty, the schema holds every table the
// migrations create, the data file holds rows for the core clinical tables, and a
// SHA-256 manifest is written so the copy can be checked again after it is moved.
//   node scripts/verify-backup.mjs <backup-folder>
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const folder = process.argv[2];
if (!folder) { console.error("Usage: node scripts/verify-backup.mjs <backup-folder>"); process.exit(2); }

const problems = [];
const text = {};
for (const name of ["roles.sql", "schema.sql", "data.sql"]) {
  const path = join(folder, name);
  const info = await stat(path).catch(() => null);
  if (!info) { problems.push(`${name} is missing`); continue; }
  if (!info.size) problems.push(`${name} is empty`);
  text[name] = await readFile(path, "utf8");
}

// Every public table created by the migrations must be in the schema dump.
const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
const tables = new Set();
for (const name of (await readdir(migrationsDir)).filter(n => n.endsWith(".sql"))) {
  const sql = await readFile(new URL(name, migrationsDir), "utf8");
  for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)/gi)) tables.add(m[1].toLowerCase());
  for (const m of sql.matchAll(/drop table (?:if exists )?public\.([a-z0-9_]+)/gi)) tables.delete(m[1].toLowerCase());
}
if (text["schema.sql"]) {
  const missing = [...tables].filter(t => !new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?public"?\\."?${t}"?[ (]`, "i").test(text["schema.sql"]));
  if (missing.length) problems.push(`schema.sql lacks ${missing.length} table(s): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ", …" : ""}`);
}

// Core tables whose data must be present (COPY with --use-copy, or INSERT).
const core = ["facilities", "facility_memberships", "patients", "encounters", "audit_logs"];
if (text["data.sql"]) {
  for (const t of core) if (!new RegExp(`(COPY|INSERT INTO) "?public"?\\."?${t}"?[ (]`, "i").test(text["data.sql"])) problems.push(`data.sql has no rows for public.${t}`);
}

const manifest = {};
for (const name of Object.keys(text)) manifest[name] = createHash("sha256").update(text[name]).digest("hex");
await writeFile(join(folder, "manifest.json"), JSON.stringify({ checked_at: new Date().toISOString(), migration_tables: tables.size, sha256: manifest }, null, 2));

console.log(`Checked ${Object.keys(text).length} file(s) against ${tables.size} tables from the migrations.`);
if (problems.length) { console.error(`Backup is NOT usable:\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log(`Backup looks complete. Checksums written to ${join(folder, "manifest.json")}.`);
