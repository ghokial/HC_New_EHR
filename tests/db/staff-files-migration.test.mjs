// The S7 migration detaches staff members' own account files from their
// facility, but only where the facility never used the file clinically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, applyMigration, helpers } from "./harness.mjs";

test("S7 migration detaches unused staff account files and keeps ones with clinical history", async () => {
  const migration = "20260927160000_security_mfa_privacy_scoping_audit.sql";
  const db = await createDatabase({ stopBefore: migration });
  const h = helpers(db);
  const owner = await h.user("owner@x.test"), unused = await h.user("unused@x.test"), treated = await h.user("treated@x.test");
  const facility = await h.facility("x-hospital", owner);
  await h.member(facility, unused, "nurse"); await h.member(facility, treated, "nurse");
  const fileOf = async userId => h.one(`select p.id,p.facility_id from public.patient_accounts pa join public.patients p on p.id=pa.patient_id where pa.user_id=$1`, [userId]);
  assert.equal((await fileOf(unused)).facility_id, facility, "before: attached by the old trigger");
  await h.q(`insert into public.vital_sign_observations(facility_id,patient_id,heart_rate) values($1,$2,70)`, [facility, (await fileOf(treated)).id]);
  await applyMigration(db, migration);
  assert.equal((await fileOf(unused)).facility_id, null, "unused file detached");
  assert.equal((await fileOf(treated)).facility_id, facility, "file with recorded vital signs stays with the facility");
  const late = await h.user("late@x.test"); await h.member(facility, late, "nurse");
  assert.equal((await fileOf(late)).facility_id, null, "new staff files are never attached");
});
