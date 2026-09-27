// Phase 2: availability, booking, cancelling and rescheduling.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";

let h, ids = {};
const rows = async promise => (await promise).rows;
const tomorrow = () => { const d = new Date(Date.now() + 86400000); return d.toISOString().slice(0, 10); };

before(async () => {
  h = helpers(await createDatabase());
  const { user, facility, member, one, q } = h;
  ids.owner = await user("owner@f1.test"); ids.reg = await user("reg@f1.test"); ids.billing = await user("billing@f1.test"); ids.doc = await user("doc@f1.test"); ids.pat = await user("pat@home.test"); ids.other = await user("other@home.test");
  ids.f1 = await facility("f-one", ids.owner);
  await member(ids.f1, ids.reg, "registration"); await member(ids.f1, ids.billing, "billing"); await member(ids.f1, ids.doc, "physician");
  ids.p = (await one(`insert into public.patients(first_name,last_name,facility_id) values('Book','Er',$1) returning id`, [ids.f1])).id;
  await q(`insert into public.patient_accounts(user_id,patient_id) values($1,$2) on conflict do nothing`, [ids.pat, ids.p]);
  ids.provider = (await one(`select id from public.providers where user_id=$1`, [ids.doc])).id;
  ids.dept = (await one(`select department_id from public.facility_departments where facility_id=$1 limit 1`, [ids.f1]))?.department_id;
  if (!ids.dept) { ids.dept = (await one(`select id from public.departments limit 1`)).id; await q(`insert into public.facility_departments(facility_id,department_id) values($1,$2)`, [ids.f1, ids.dept]); }
});

test("scheduling staff create repeating availability; billing staff cannot", async () => {
  const day = tomorrow(), isodow = ((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  const result = (await h.as(ids.reg, "aal2", () => h.q(`select public.generate_availability_slots($1,$2,$3,null,$4::date,$4::date,$5::int[],'08:00','10:00',30,'Africa/Kinshasa') as r`, [ids.f1, ids.provider, ids.dept, day, [isodow]]))).rows[0].r;
  assert.equal(result.created, 4, "08:00-10:00 in 30-minute slots");
  const again = (await h.as(ids.reg, "aal2", () => h.q(`select public.generate_availability_slots($1,$2,$3,null,$4::date,$4::date,$5::int[],'08:00','10:00',30,'Africa/Kinshasa') as r`, [ids.f1, ids.provider, ids.dept, day, [isodow]]))).rows[0].r;
  assert.deepEqual([again.created, again.skipped_overlaps], [0, 4], "a provider is never double-booked");
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`select public.generate_availability_slots($1,$2,$3,null,$4::date,$4::date,$5::int[],'08:00','10:00',30,'UTC')`, [ids.f1, ids.provider, ids.dept, day, [isodow]])), /Only scheduling/);
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`insert into public.provider_availability_slots(facility_id,department_id,provider_id,starts_at,ends_at) values($1,$2,$3,now()+interval '5 days',now()+interval '5 days 20 minutes')`, [ids.f1, ids.dept, ids.provider])), /row-level security/);
});
test("patients book from the portal with the three-argument call", async () => {
  ids.slot1 = (await h.one(`select id from public.provider_availability_slots where status='available' order by starts_at limit 1`)).id;
  ids.appt = (await h.as(ids.pat, "aal1", () => h.q(`select public.book_available_slot(slot_to_book=>$1,patient_to_book=>$2,booking_reason=>null) as id`, [ids.slot1, ids.p]))).rows[0].id;
  assert.ok(ids.appt);
});
test("front-desk staff book for a patient registered at their facility; strangers cannot", async () => {
  const slot = (await h.one(`select id from public.provider_availability_slots where status='available' order by starts_at limit 1`)).id;
  await assert.rejects(h.as(ids.other, "aal1", () => h.q(`select public.book_available_slot($1,$2,null,false)`, [slot, ids.p])), /booking access required/);
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`select public.book_available_slot($1,$2,null,false)`, [slot, ids.p])), /booking access required/);
  ids.appt2 = (await h.as(ids.reg, "aal2", () => h.q(`select public.book_available_slot($1,$2,'Phone booking',false) as id`, [slot, ids.p]))).rows[0].id;
  assert.ok(ids.appt2);
});
test("patients cancel their own visit and the slot reopens for others", async () => {
  await h.as(ids.pat, "aal1", () => h.q(`select public.cancel_appointment_keep_calendar($1)`, [ids.appt]));
  assert.equal((await h.one(`select status from public.appointments where id=$1`, [ids.appt])).status, "cancelled", "kept on the calendar as cancelled");
  assert.equal((await h.one(`select status from public.provider_availability_slots where id=$1`, [ids.slot1])).status, "available");
  const rebooked = (await h.as(ids.reg, "aal2", () => h.q(`select public.book_available_slot($1,$2,null,false) as id`, [ids.slot1, ids.p]))).rows[0].id;
  assert.ok(rebooked, "the reopened slot can be booked again");
  await assert.rejects(h.as(ids.pat, "aal1", () => h.q(`select public.cancel_appointment_keep_calendar($1)`, [ids.appt])), /already cancelled/);
});
test("only scheduling staff reschedule, and only booked appointments", async () => {
  const free = (await h.one(`select id from public.provider_availability_slots where status='available' order by starts_at limit 1`)).id;
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`select public.reschedule_appointment($1,$2)`, [ids.appt2, free])), /Scheduling access required/);
  await h.as(ids.reg, "aal2", () => h.q(`select public.reschedule_appointment($1,$2)`, [ids.appt2, free]));
  assert.equal((await h.one(`select slot_id from public.appointments where id=$1`, [ids.appt2])).slot_id, free);
  assert.equal((await rows(h.as(ids.billing, "aal2", () => h.q(`update public.appointments set status='no_show' where id=$1 returning id`, [ids.appt2])))).length, 0, "billing cannot change appointments");
});
