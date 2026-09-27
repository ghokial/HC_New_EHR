// HL7 v2 parsing and message building for laboratory interfaces.
import test from "node:test";
import assert from "node:assert/strict";
import { ack, buildOrm, get, hl7Time, parse, parseOru } from "../supabase/functions/_shared/hl7v2.js";

// A synthetic ORU^R01 in HL7 2.5.1 layout; identifiers and values are test data.
const oru = [
  "MSH|^~\\&|LABSYS|CENTRAL LAB|HEALTHCAROLOGY|F-ONE|20260927101500||ORU^R01^ORU_R01|MSG0001|P|2.5.1",
  "PID|1||10L-F990-00003^^^HEALTHCAROLOGY^UNIN~MRN-77^^^F-ONE^MR||MBUYI^AMINA||19900201|F",
  "OBR|1|42|LAB-9|HC-LAB-GLU^Blood Glucose|||20260927093000",
  "OBX|1|NM|GLU^Glucose||9.1|mmol/L|3.9-5.5|H|||F|||20260927100000",
  "OBX|2|ST|COMMENT^Comment||Fasting \\T\\ hemolysed||||||P",
].join("\r");

test("parses separators, repetitions, components and escapes", () => {
  const { segments } = parse(oru);
  assert.equal(segments[0].type, "MSH"); assert.equal(get(segments[0], 9, 1), "ORU"); assert.equal(get(segments[0], 10), "MSG0001");
  assert.equal(get(segments[1], 3, 1, 2), "MRN-77", "second repetition of PID-3");
  assert.equal(get(segments[4], 5), "Fasting & hemolysed", "\\T\\ unescapes to the subcomponent separator");
});

test("converts HL7 timestamps, including time zones", () => {
  assert.equal(hl7Time("20260927101500"), "2026-09-27T10:15:00.000Z");
  assert.equal(hl7Time("202609271015+0100"), "2026-09-27T09:15:00.000Z");
  assert.equal(hl7Time("20260927"), "2026-09-27T00:00:00.000Z");
  assert.equal(hl7Time("not a date"), null);
});

test("extracts results by order with units, ranges, flags and status", () => {
  const r = parseOru(oru);
  assert.equal(r.controlId, "MSG0001"); assert.deepEqual(r.patientIdentifiers.map(x => x.value), ["10L-F990-00003", "MRN-77"]);
  const [order] = r.orders; assert.equal(order.placerOrderId, "42"); assert.equal(order.observations.length, 2);
  const [glu, note] = order.observations;
  assert.deepEqual([glu.code, glu.numericValue, glu.units, glu.referenceRange, glu.interpretation, glu.status], ["GLU", 9.1, "mmol/L", "3.9-5.5", "out_of_range", "final"]);
  assert.equal(note.numericValue, null); assert.equal(note.status, "preliminary");
});

test("rejects messages that cannot be matched safely", () => {
  assert.throws(() => parseOru(oru.replace("ORU^R01", "ADT^A01")), /Expected ORU\^R01/);
  assert.throws(() => parseOru(oru.replace("|MSG0001|", "||")), /control ID/);
  assert.throws(() => parseOru(oru.replace(/\rPID\|[^\r]*/, "")), /PID segment/);
  assert.throws(() => parseOru(oru.replace("OBR|1|42|", "OBR|1||")), /placer order number/);
  assert.throws(() => parseOru("PID|1"), /MSH/);
});

test("ACK echoes the control ID and escapes free text", () => {
  const a = ack("MSG0001", "AE", "Order 42|x", { now: new Date("2026-09-27T10:00:00Z"), ackControlId: "A1" });
  const { segments } = parse(a);
  assert.equal(get(segments[0], 9, 1), "ACK"); assert.equal(get(segments[1], 1), "AE"); assert.equal(get(segments[1], 2), "MSG0001"); assert.equal(get(segments[1], 3), "Order 42|x");
});

test("ORM^O01 carries the lab order id in OBR-2 and round-trips through the parser", () => {
  const orm = buildOrm({ controlId: "ORM42", now: new Date("2026-09-27T08:00:00Z"), patient: { first_name: "Amina", last_name: "Mbuyi", sex: "F", date_of_birth: "1990-02-01", snau: "10L-F990-00003", mrn: "MRN-77" }, order: { id: 42, test_code: "HC-LAB-GLU", priority: "STAT", created_at: "2026-09-27T08:00:00Z" }, facilityName: "F-ONE" });
  const { segments } = parse(orm);
  assert.equal(get(segments[0], 9, 1), "ORM"); assert.equal(get(segments[1], 3, 1, 1), "10L-F990-00003"); assert.equal(get(segments[1], 8), "F");
  const obr = segments.find(s => s.type === "OBR"); assert.equal(get(obr, 2), "42"); assert.equal(get(obr, 4, 1), "HC-LAB-GLU"); assert.equal(get(obr, 5), "S");
});
