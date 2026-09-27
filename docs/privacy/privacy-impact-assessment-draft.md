# Privacy impact assessment (DRAFT)

**Status: draft for review. Not legal advice and not approved.** Claude prepared this from the code on 27 September 2026. It describes what personal data the software processes, where it goes, and what protections the code has, with evidence. The organisation's data protection lead or legal adviser must:

- confirm which laws apply,
- set the lawful basis and the retention periods,
- complete the sections marked **To decide**, and
- sign it off.

`REQUIREMENTS.md:27` records that the source documents cite Congolese law, GDPR and HIPAA as guidance but give no validated compliance position. The structure below follows a GDPR Article 35 style assessment, so it can be adapted to whichever law applies.

## 1. What is processed

| Category | Examples (tables) | Who it is about |
|---|---|---|
| Identity and contact | `patients` (names, date of birth, sex, UNIN, MRN), `patient_contact_methods`, `addresses`, `profile_photos` | Patients, relatives (proxies) |
| Health data (special category) | `encounters`, `diagnoses`, `clinical_notes`, `patient_allergies`, `medication_orders`, `medication_administrations`, `lab_results`, `imaging_orders`, `immunizations`, `prenatal_visits`, `partographs`, blood bank, dialysis and inpatient tables | Patients |
| Financial | `inpatient_accounts`, `inpatient_claims`, `facility_charge_lines`, `patient_insurance_enrollments`, `wallet_accounts`, `wallet_transactions` | Patients |
| Staff | `profiles`, `facility_memberships`, `staff_shifts`; staff members' own health files | Staff |
| Activity records | `audit_logs` (who viewed or changed which record), `shared_record_access_audit`, `data_export_audit` | Staff, patients, external recipients |

## 2. Where data goes

| Flow | What leaves | Controls in the software (evidence) | Open points |
|---|---|---|---|
| Hosting: Supabase project `pwmshlfnijluqmitkood` (database, sign-in, file storage, Edge Functions) | Everything | Row-level security on every table; MFA required for staff access to clinical data (`tests/db/rls.test.mjs`, S5 tests) | **To decide:** hosting region and cross-border transfer basis; data processing agreement with Supabase |
| Between facilities (record exchange) | Sections the patient approves | Exact UNIN + last name + date of birth to request; patient approves, chooses the duration and can revoke; emergency access is physicians only, 24 hours, flagged to both facilities and shown to the patient (`tests/db/record-exchange.test.mjs`) | None found |
| Patient-created share links | Selected record elements, to an email or phone | Created only with MFA; random token and password stored only as SHA-256 hashes; expiry required; each view logged (`supabase/functions/create-record-share/index.ts`, `shared_record_access_audit`) | The temporary password is shown once to the patient to pass on; advise sending it by a different channel from the link |
| SMART on FHIR apps | The patient's own data, within the approved scopes | Root registers apps; https redirects; single-use PKCE codes; every token use audited; access stops on withdrawal (`tests/db/smart.test.mjs`) | **To decide:** approval process and contract for each third-party app |
| Lab interfaces (HL7 v2) | Results coming in | Per-interface key; results matched to order and patient, held for validation; mismatches rejected and logged (`tests/db/hl7-lab.test.mjs`) | Transport security depends on the lab's connection |
| Imaging archive (DICOMweb) | Accession number and patient identifiers in queries | Archive credentials kept in Edge Function secrets, not in the database (`tests/db/dicom.test.mjs`) | Contract with the PACS provider |
| DHIS2 | Monthly aggregate counts only, no patient rows (`tests/db/reporting.test.mjs`) | Admin-only mapping, preview, each send recorded in `data_export_audit` | **Small numbers:** a small facility's monthly count (e.g. 1 emergency access) could point to an individual; no small-cell suppression is implemented |
| CSV report download | Same aggregates | Recorded in `data_export_audit` before download (`reporting.js`) | File leaves the system's control once downloaded |
| Email invitations | Staff email addresses | Invitation links instead of shared temporary passwords (`create-user`, `create-facility`) | Supabase's email provider is a further processor |
| Backups | Everything | Runbook requires encryption and two organisation-controlled locations (`docs/operations/backup-and-restore.md`) | Not yet run; see the runbook |

## 3. Protections already in the code

- **Need to know.** Staff see only the patients of the facility they are working in, according to their role. A clinician in two facilities sees only the one they have selected. Former staff lose access when their membership ends. All of this is tested for every table by `tests/db/policy-rewrite-equivalence.test.mjs` and `tests/db/rls.test.mjs`.
- **MFA.** Staff need MFA for clinical data. Accounts that still have a temporary password get no staff access (`rls.test.mjs`, S6).
- **Staff health records.** A staff member's own health file is not visible to colleagues (`rls.test.mjs`, S7).
- **Accountability.** Changes and chart views are written to an append-only audit log that only oversight roles (HIM, compliance, administrators) can read (`rls.test.mjs`, audit test).
- **Transparency to patients.** Patients see requests for their records and emergency accesses in their portal (`record-exchange.js`).

## 4. Risks and gaps

| ID | Risk to individuals | Gap | Proposed measure |
|---|---|---|---|
| P1 | Someone reads a record on an unattended workstation | No inactivity timeout (`supabase/config.toml` lines 271–275 commented out) | Set session inactivity timeout; in-app idle lock |
| P2 | Data kept longer than needed | No retention periods or deletion schedule defined | **To decide:** retention per record type under local medical-records law; then implement archiving |
| P3 | Patient cannot exercise rights (access, correction) easily | Portal shows the patient their own record; no formal request-handling process is in the code | Procedure for access and correction requests; erasure usually conflicts with medical-record retention and the append-only audit log, so explain this in the privacy notice |
| P4 | Re-identification from small aggregate counts | No small-cell suppression in DHIS2 export or CSV | Suppress or round counts below a threshold agreed with the health authority |
| P5 | Duplicate patient records spread one person's data across two charts | See hazard H01 in `docs/safety/clinical-hazard-log.md` | Search and merge workflow |
| P6 | Patients and staff are not told how their data is used | No privacy notice found in the portal | Privacy notice and staff confidentiality agreement |
| P7 | A breach goes unnoticed or unreported | Audit data exists but there is no alerting or breach procedure | Review break-glass and unusual-access reports weekly; breach response procedure with notification timelines under the applicable law |

## 5. Sign-off

- Data protection lead: ______________________ (name, date)
- Clinical lead: ______________________ (name, date)
- Decision: proceed / proceed with measures / do not proceed
