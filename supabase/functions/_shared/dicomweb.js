// DICOMweb (QIDO-RS) helpers: build the study search and read the DICOM JSON model
// (PS3.18 Annex F). Pure functions shared by the Edge Function and the tests.

export const TAGS = {
  StudyInstanceUID: "0020000D",
  StudyDate: "00080020",
  StudyTime: "00080030",
  AccessionNumber: "00080050",
  ModalitiesInStudy: "00080061",
  StudyDescription: "00081030",
  PatientID: "00100020",
  PatientName: "00100010",
  NumberOfStudyRelatedInstances: "00201208",
};

// A DICOM UID: digits and dots, at most 64 characters (PS3.5 9.1).
export const validUid = uid => /^[0-9]+(\.[0-9]+)*$/.test(String(uid || "")) && String(uid).length <= 64;

export function studySearchUrl(baseUrl, accessionNumber) {
  const url = new URL(`${String(baseUrl).replace(/\/+$/, "")}/studies`);
  url.searchParams.set("AccessionNumber", accessionNumber);
  for (const tag of ["StudyInstanceUID", "StudyDate", "StudyDescription", "ModalitiesInStudy", "PatientID", "AccessionNumber", "NumberOfStudyRelatedInstances"]) url.searchParams.append("includefield", TAGS[tag]);
  return url.toString();
}

const first = (dataset, tag) => dataset?.[tag]?.Value?.[0];
const all = (dataset, tag) => dataset?.[tag]?.Value || [];

export function parseStudies(json) {
  if (!Array.isArray(json)) return [];
  return json.map(dataset => ({
    studyInstanceUid: first(dataset, TAGS.StudyInstanceUID) || null,
    studyDate: first(dataset, TAGS.StudyDate) ? String(first(dataset, TAGS.StudyDate)).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") : null,
    description: first(dataset, TAGS.StudyDescription) || null,
    modalities: all(dataset, TAGS.ModalitiesInStudy),
    patientId: first(dataset, TAGS.PatientID) || null,
    accessionNumber: first(dataset, TAGS.AccessionNumber) || null,
    instances: first(dataset, TAGS.NumberOfStudyRelatedInstances) ?? null,
  })).filter(study => validUid(study.studyInstanceUid));
}

// Fills a viewer URL template such as https://viewer/viewer?StudyInstanceUIDs={StudyInstanceUID}
export function viewerUrl(template, studyInstanceUid) {
  if (!template || !validUid(studyInstanceUid)) return null;
  return String(template).replaceAll("{StudyInstanceUID}", encodeURIComponent(studyInstanceUid));
}
