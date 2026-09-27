// Minimal HL7 v2 (2.5.1) support for laboratory interfaces: parse ORU^R01 results,
// build ORM^O01 orders, and build ACK replies. Pure functions, no I/O, shared by the
// Edge Function (Deno) and the Node tests.

const SEGMENT_SPLIT = /\r\n|\r|\n/;

// Parses a message into segments. Field and component separators come from MSH.
export function parse(text) {
  const raw = String(text || "").replace(/^\x0b|\x1c\r?$/g, "").trim();
  if (!raw.startsWith("MSH")) throw new Error("Message must start with an MSH segment");
  const fieldSep = raw[3], enc = raw.slice(4, 8);
  const [component, repetition, escape, subcomponent] = enc;
  const unescape = value => value
    .replaceAll(`${escape}F${escape}`, fieldSep).replaceAll(`${escape}S${escape}`, component)
    .replaceAll(`${escape}R${escape}`, repetition).replaceAll(`${escape}T${escape}`, subcomponent)
    .replaceAll(`${escape}E${escape}`, escape);
  const segments = raw.split(SEGMENT_SPLIT).filter(Boolean).map(line => {
    const fields = line.split(fieldSep);
    // MSH-1 is the separator itself, so MSH fields are shifted by one.
    if (fields[0] === "MSH") fields.splice(1, 0, fieldSep);
    return { type: fields[0], fields: fields.map(f => f.split(repetition).map(rep => rep.split(component).map(unescape))) };
  });
  return { segments, separators: { fieldSep, component, repetition, escape, subcomponent } };
}

// Value of segment field `n`, repetition `r`, component `c` (1-based like the HL7 spec).
export const get = (segment, n, c = 1, r = 1) => segment?.fields?.[n]?.[r - 1]?.[c - 1] ?? "";
const repetitions = (segment, n) => segment?.fields?.[n] || [];

// HL7 timestamp YYYYMMDD[HHMM[SS]][+/-ZZZZ] -> ISO 8601, or null.
export function hl7Time(value) {
  const m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(?:(\d{2}))?)?(?:\.\d+)?([+-]\d{4})?$/);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00", tz] = m;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "Z";
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`).toISOString();
}

const flagToInterpretation = flag => {
  const f = String(flag || "").toUpperCase();
  if (!f || f === "N") return f ? "normal" : null;
  if (["HH", "LL", "AA", "<", ">"].includes(f)) return "dangerously_abnormal";
  if (["H", "L", "A"].includes(f)) return "out_of_range";
  return null;
};
const resultStatus = code => ({ F: "final", P: "preliminary", C: "corrected", X: "cancelled", I: "pending" })[String(code || "").toUpperCase()] || "preliminary";

// Extracts laboratory results from an ORU^R01 message, grouped by order (OBR).
export function parseOru(text) {
  const { segments } = parse(text);
  const msh = segments[0];
  const messageType = `${get(msh, 9, 1)}^${get(msh, 9, 2)}`;
  if (messageType !== "ORU^R01") throw new Error(`Expected ORU^R01, received ${messageType}`);
  const controlId = get(msh, 10);
  if (!controlId) throw new Error("MSH-10 message control ID is required");
  const pid = segments.find(s => s.type === "PID");
  if (!pid) throw new Error("A PID segment is required");
  const identifiers = repetitions(pid, 3).map(rep => ({ value: rep[0] || "", type: rep[4] || "" })).filter(x => x.value);
  if (!identifiers.length) throw new Error("PID-3 must identify the patient");
  const orders = [];
  let current = null;
  for (const segment of segments) {
    if (segment.type === "OBR") {
      current = { placerOrderId: get(segment, 2), fillerOrderId: get(segment, 3), testCode: get(segment, 4, 1), testName: get(segment, 4, 2), observedAt: hl7Time(get(segment, 7)), observations: [] };
      if (!current.placerOrderId) throw new Error("OBR-2 placer order number is required to match the Healthcarology order");
      orders.push(current);
    } else if (segment.type === "OBX") {
      if (!current) throw new Error("OBX found before any OBR");
      const valueType = get(segment, 2), rawValue = get(segment, 5);
      const numeric = valueType === "NM" && rawValue !== "" && Number.isFinite(Number(rawValue)) ? Number(rawValue) : null;
      current.observations.push({
        code: get(segment, 3, 1) || current.testCode, name: get(segment, 3, 2), valueType, value: rawValue, numericValue: numeric,
        units: get(segment, 6, 1), referenceRange: get(segment, 7), abnormalFlag: get(segment, 8),
        interpretation: flagToInterpretation(get(segment, 8)), status: resultStatus(get(segment, 11)),
        observedAt: hl7Time(get(segment, 14)) || current.observedAt,
      });
    }
  }
  if (!orders.length) throw new Error("At least one OBR segment is required");
  return { controlId, messageType, sendingApplication: get(msh, 3), sendingFacility: get(msh, 4), patientIdentifiers: identifiers, orders };
}

const escapeValue = value => String(value ?? "").replaceAll("\\", "\\E\\").replaceAll("|", "\\F\\").replaceAll("^", "\\S\\").replaceAll("~", "\\R\\").replaceAll("&", "\\T\\").replace(/[\r\n]+/g, " ");
export const hl7Now = (date = new Date()) => date.toISOString().replace(/[-:T]/g, "").slice(0, 14);

// ACK for a received message: AA accepted, AE error, AR rejected.
export function ack(controlId, code, text = "", { sendingApplication = "HEALTHCAROLOGY", receivingApplication = "", now = new Date(), ackControlId } = {}) {
  return [
    `MSH|^~\\&|${sendingApplication}||${escapeValue(receivingApplication)}||${hl7Now(now)}||ACK^R01^ACK|${ackControlId || `ACK${hl7Now(now)}`}|P|2.5.1`,
    `MSA|${code}|${escapeValue(controlId)}${text ? `|${escapeValue(text)}` : ""}`,
  ].join("\r");
}

// ORM^O01 new order (NW) for the lab system. OBR-2 carries the lab order id so the
// results can be matched back.
export function buildOrm({ controlId, now = new Date(), patient, order, facilityName = "", receivingApplication = "" }) {
  const name = `${escapeValue(patient.last_name)}^${escapeValue(patient.first_name)}${patient.middle_name ? `^${escapeValue(patient.middle_name)}` : ""}`;
  const ids = [patient.snau ? `${escapeValue(patient.snau)}^^^HEALTHCAROLOGY^UNIN` : "", patient.mrn ? `${escapeValue(patient.mrn)}^^^${escapeValue(facilityName)}^MR` : ""].filter(Boolean).join("~");
  const sex = patient.sex === "M" || patient.sex === "F" ? patient.sex : "U";
  return [
    `MSH|^~\\&|HEALTHCAROLOGY|${escapeValue(facilityName)}|${escapeValue(receivingApplication)}||${hl7Now(now)}||ORM^O01^ORM_O01|${escapeValue(controlId)}|P|2.5.1`,
    `PID|1||${ids}||${name}||${(patient.date_of_birth || "").replaceAll("-", "")}|${sex}`,
    `ORC|NW|${escapeValue(order.id)}|||||||${hl7Now(new Date(order.created_at || now))}`,
    `OBR|1|${escapeValue(order.id)}||${escapeValue(order.test_code)}^${escapeValue(order.test_name || order.test_code)}|${escapeValue(order.priority === "STAT" ? "S" : "R")}|${hl7Now(new Date(order.created_at || now))}`,
  ].join("\r");
}
