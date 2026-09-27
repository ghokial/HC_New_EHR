// DICOMweb QIDO-RS helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { parseStudies, studySearchUrl, validUid, viewerUrl } from "../supabase/functions/_shared/dicomweb.js";

test("the study search asks for the accession number and the needed attributes", () => {
  const url = new URL(studySearchUrl("https://pacs.example/dicom-web/", "HC0000000042"));
  assert.equal(url.pathname, "/dicom-web/studies"); assert.equal(url.searchParams.get("AccessionNumber"), "HC0000000042");
  assert.ok(url.searchParams.getAll("includefield").includes("0020000D")); assert.ok(url.searchParams.getAll("includefield").includes("00100020"));
});

test("reads the DICOM JSON model and drops entries without a valid Study Instance UID", () => {
  // Shape per DICOM PS3.18 Annex F; values are test data.
  const studies = parseStudies([
    { "0020000D": { vr: "UI", Value: ["1.2.840.113619.2.55.3.1234"] }, "00080020": { vr: "DA", Value: ["20260927"] }, "00081030": { vr: "LO", Value: ["CT CHEST"] }, "00080061": { vr: "CS", Value: ["CT", "SR"] }, "00100020": { vr: "LO", Value: ["10L-F990-00003"] }, "00080050": { vr: "SH", Value: ["HC0000000042"] }, "00201208": { vr: "IS", Value: [120] } },
    { "0020000D": { vr: "UI", Value: ["not-a-uid"] } },
  ]);
  assert.equal(studies.length, 1);
  assert.deepEqual(studies[0], { studyInstanceUid: "1.2.840.113619.2.55.3.1234", studyDate: "2026-09-27", description: "CT CHEST", modalities: ["CT", "SR"], patientId: "10L-F990-00003", accessionNumber: "HC0000000042", instances: 120 });
  assert.deepEqual(parseStudies(null), []);
});

test("UIDs are validated and the viewer URL is filled safely", () => {
  assert.ok(validUid("1.2.3")); assert.ok(!validUid("1..2")); assert.ok(!validUid("1.2.a")); assert.ok(!validUid("1." + "2".repeat(64)));
  assert.equal(viewerUrl("https://viewer/viewer?StudyInstanceUIDs={StudyInstanceUID}", "1.2.3"), "https://viewer/viewer?StudyInstanceUIDs=1.2.3");
  assert.equal(viewerUrl("https://viewer/x?u={StudyInstanceUID}", "javascript:alert(1)"), null);
});
