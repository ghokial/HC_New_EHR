# Healthcarology EHR requirements ledger

This ledger separates the user's request (build the Healthcarology EHR without inventing requirements) from content found in the supplied documents. The application uses demonstration records only; it is not connected to a live clinical system.

## Source documents

- `HEALTHCAROLOGY_EHR.docx`: global geography, patients, encounters, departments/services, providers, orders/results, medication orders/administration, clinical notes, REST routes, Supabase RLS, JWT claims, portal rules, patient accounts and proxies.
- `Healthcarology UNIN Registry.docx`: UNIN/SNAU identity format, person/category/reference records, family links, audit logs, enrollment/verification workflows, governance and security.
- `User_types_access_and_roles.docx`: user categories, access levels, role-permission matrix, root-access controls, MFA, least privilege, break-glass, logging and audit requirements.
- `Departments_&_Services Major Hospital.docx`: hospital department/service catalog and a compact JSON/SQL integration structure.

## Implemented in this prototype

- Responsive internal EHR shell and role-labelled clinical workspace.
- Patient list, global search, selected chart summary, encounters, orders/results, medications, notes, departments/services, UNIN validation, RBAC matrix, and audit view.
- Clearly labelled demonstration data; no patient facts are represented as real.
- Supabase/Postgres migration covering the entities explicitly defined in the sources.
- RLS enabled on every public table. Policies use authorization values from `app_metadata`; the supplied documents' older `auth.role()` examples were not copied because current Supabase guidance deprecates that pattern.
- Patient account/proxy tables and patient-scoped policy foundation.
- Global location and translation tables.

## Not implemented because the documents or environment do not supply enough information

- Live Supabase project connection, credentials, authentication, MFA, backups, monitoring, or deployment.
- Production-grade terminology integrations (LOINC, ICD, CPT, PACS), e-prescribing, billing/claims workflows, appointment messaging, document storage, or external EHR interoperability contracts.
- Real UNIN issuance or uniqueness validation against ONIP; the UI checks only the exact example format supplied by the registry document.
- Legal/compliance certification. The documents mention HIPAA-inspired controls, Congolese law, and GDPR as guidance, but do not provide a compliance authorization or validated control set.
- Clinical decision support, diagnoses, allergies, vitals, immunizations, problem lists, or patient clinical values because those were not specified as structured modules in the supplied EHR schema.

## Requirement conflicts retained for review

- The EHR document shows both broad authenticated access examples and tighter role/provider access. The migration uses the tighter approach.
- The documents show JWT authorization values at the top level. Current Supabase guidance requires server-controlled authorization data; the migration reads `app_metadata` instead.
- The documented SNAU format narrative and example regex are not fully general for all category/dependent combinations. The prototype validates only the supplied example regex and explicitly says that this is not a uniqueness check.
