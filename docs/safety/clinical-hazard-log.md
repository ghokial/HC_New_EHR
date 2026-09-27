# Clinical safety hazard log (DRAFT)

**Status: draft for review. Not approved.** Claude prepared this from the code on 27 September 2026. It lists hazards found in the software and the controls the code actually has, with evidence. It is not a clinical safety case and does not show compliance with any standard.

A named, clinically qualified safety officer must:

- review every entry,
- score severity and likelihood with the organisation's own risk matrix (left blank here on purpose),
- add hazards that come from how the facilities work, and
- decide whether residual risk is acceptable before clinical use.

Structured approaches that can serve as the template include ISO 14971 (risk management for health software) and the UK's DCB0129/DCB0160. Which one applies depends on the country of use. `REQUIREMENTS.md:27` records that the source documents cite Congolese law, GDPR and HIPAA as guidance only.

Status key:

- **Controlled**: a control exists and a test checks it.
- **Partly controlled**: a control exists but has a gap.
- **Open**: no control in the software yet.

| ID | Hazard | Cause | Controls in the software (evidence) | Status | Proposed action |
|---|---|---|---|---|---|
| H01 | Clinician cannot find an existing patient and registers a duplicate, splitting the record (missed allergies, history) | Patient list and encounter patient picker load at most 1,000 rows (`live.js:210`, `live.js:43`, `max_rows=1000` in `supabase/config.toml`); patients past the first 1,000 alphabetically are silently missing | None found. No duplicate-patient check or merge workflow was found in the migrations | **Open** | Server-side search with paging; warn on likely duplicates (same name and date of birth) at registration; a supervised merge workflow |
| H02 | Prescribed drug interacts dangerously with another active drug and no alert fires | The interaction table ships empty on purpose (`tests/db/rls.test.mjs` notes that the migrations seed none), so interaction checking does nothing until a catalogue is loaded | Interaction check blocks orders when a pair exists, and requires a logged override reason (`rls.test.mjs`, "prescribing: interactions and duplicate orders block without a reason") | **Partly controlled** | Licence and load a maintained interaction knowledge base; until then, show staff that interaction checking is not active |
| H03 | Drug given to a patient with a known allergy | Allergy not recorded, or recorded as free text that does not match the drug | Matching allergy blocks the order until a reason is given, and the override is logged (`rls.test.mjs`, prescribing tests); allergies cannot be moved to another patient or deleted | **Partly controlled** | Matching uses the allergy's medication or substance text; review coverage for drug classes (e.g. penicillins) with pharmacy |
| H04 | Duplicate medication or investigation ordered | Order placed twice | Duplicate medication orders are blocked without a reason (`rls.test.mjs`); order screen warns of possible duplicate orders (`live.js:630`) | Controlled | Confirm the duplicate window with clinicians |
| H05 | Critically abnormal lab result is not noticed in time | Results carry `abnormal_flag`/`interpretation`, but no critical-result alert or acknowledgement workflow was found | Results must be validated before release (lab validation status); HL7 results arrive unvalidated (`tests/db/hl7-lab.test.mjs`) | **Open** | Critical-value rules per test, an alert to the ordering clinician, and a record of the read-back or acknowledgement |
| H06 | Wrong patient's record opened or documented in | Similar names; several charts open | Chart views are logged (`log_patient_record_view`, audit test in `rls.test.mjs`), which supports investigation afterwards but does not prevent the error | **Open** | Show two identifiers (name + date of birth + UNIN) on every order and note form; usability test |
| H07 | Result or document from a lab interface is filed against the wrong patient | HL7 message identifiers mismatch | Results are stored only when they match both the order and the patient; wrong-patient, other-facility and unknown-order messages are rejected and logged; results wait for supervisor validation (`tests/db/hl7-lab.test.mjs`) | Controlled | Review rejected messages daily |
| H08 | Clinical information unavailable during an outage (no access to allergies or medications) | Supabase or internet outage; accidental data loss | Logical backup runbook and checker (`docs/operations/backup-and-restore.md`, `tests/verify-backup.test.mjs`) | **Partly controlled** | Agree RPO/RTO; run and record a restore drill; paper downtime forms and a printed medication chart for inpatients |
| H09 | Screens time out as data grows, blocking care | Per-row access checks | Fixed by `20260928100000_policy_per_statement_checks.sql`; measured in `docs/operations/load-test-results.md` | Controlled | Re-run `pnpm test:load` after large releases |
| H10 | Staff act on another facility's patient data without authority, or patient data is exposed | Access-rule error | Row-level security tested per role and facility (`tests/db/rls.test.mjs`, `policy-rewrite-equivalence.test.mjs`); MFA required for staff clinical data; emergency access is physicians only, needs a written reason, lasts 24 hours and is flagged to both facilities (`tests/db/record-exchange.test.mjs`) | Controlled | Periodic access review by facility administrators |
| H11 | Unattended signed-in workstation used by someone else | No idle sign-out: `[auth.sessions]` `timebox` and `inactivity_timeout` are commented out in `supabase/config.toml` (lines 271–275) | Sign-in tokens expire hourly (`jwt_expiry = 3600`) but refresh automatically | **Open** | Set an inactivity timeout on the hosted project (Auth settings) and an in-app idle lock for shared workstations |
| H12 | Discharge medication list is incomplete or wrong | Reconciliation skipped | Discharge is blocked until every active medication has a discharge decision; stopping or changing one needs a note; only prescribers reconcile (`tests/db/discharge.test.mjs`) | Controlled | Pharmacist review for high-risk discharges |
| H13 | Medication administered twice or to the wrong patient on the ward | eMAR entry against the wrong order | Only nurses record doses; entries cannot be edited, and corrections must match the order (`rls.test.mjs`, eMAR test) | **Partly controlled** | Barcode patient and medication scanning is not implemented |
| H14 | Aggregate report sent to DHIS2 is wrong and misinforms public-health decisions | Wrong metric-to-data-element mapping; wrong month | Admin-only mapping to the facility's own DHIS2 identifiers, payload preview before sending, every send recorded (`tests/db/reporting.test.mjs`) | **Partly controlled** | Health-information officer checks the first months of figures against the register |
| H15 | Imaging study linked to the wrong order | Wrong Study Instance UID entered | Each imaging order gets a unique accession number; a study links only when the accession number and the patient's UNIN or MRN both match (`tests/db/dicom.test.mjs`) | Controlled | Send the accession number to the modality worklist so technologists do not type it |
| H16 | External SMART app reads more than the patient allowed | Scope handling error | A person can authorise only their own record or a linked child's; codes are single-use and need the PKCE verifier; every token use is audited and access stops on withdrawal (`tests/db/smart.test.mjs`) | Controlled | Register only reviewed apps |

## Items to add after review

- Hazards from local workflows (triage, maternity/partograph, blood bank, dialysis, ambulance), which have modules in the code but were not reviewed here.
- Training and competency, and a named clinical safety officer.
- Incident reporting route for software-related clinical incidents.

Review sign-off: ______________________ (name, role, date)
