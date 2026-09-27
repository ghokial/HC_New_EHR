// HL7 v2 endpoint for laboratory systems and interface engines (over HTTPS).
//   POST /hl7-lab          body: ORU^R01 message   -> ACK (AA accepted, AE error, AR rejected)
//   GET  /hl7-lab/orders   -> pending lab orders as ORM^O01 messages, one per line pair
// Authenticate with the header  X-Interface-Key: <secret from create_lab_interface>.
// Results are stored as "pending validation"; a laboratory supervisor releases them.
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { ack, buildOrm, parseOru } from "../_shared/hl7v2.js";

const hl7 = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "x-application/hl7-v2+er7; charset=utf-8", "Cache-Control": "no-store" } });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async req => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const key = req.headers.get("x-interface-key") || "";
  const { data: iface } = key ? await admin.from("lab_interfaces").select("id,name,active").eq("key_hash", await sha256(key)).maybeSingle() : { data: null };
  if (!iface?.active) return hl7(ack("", "AR", "Unknown or inactive interface key"), 401);

  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/orders")) {
    const { data, error } = await admin.rpc("hl7_pending_lab_orders", { target_interface: iface.id });
    if (error) return hl7(ack("", "AE", error.message), 500);
    const messages = (data || []).map((o: any, i: number) => buildOrm({
      controlId: `ORM${o.lab_order_id}`,
      patient: { first_name: o.first_name, middle_name: o.middle_name, last_name: o.last_name, sex: o.sex, date_of_birth: o.date_of_birth, snau: o.snau, mrn: o.mrn },
      order: { id: o.lab_order_id, test_code: o.test_code, priority: o.priority, created_at: o.created_at },
      facilityName: o.facility_name, receivingApplication: iface.name,
    }));
    return hl7(messages.join("\r\n\r\n"));
  }
  if (req.method !== "POST") return hl7(ack("", "AR", "Use POST for results or GET /orders"), 405);

  const raw = await req.text();
  let parsed;
  try { parsed = parseOru(raw); }
  catch (error) { return hl7(ack("", "AR", error instanceof Error ? error.message : String(error), { receivingApplication: iface.name }), 400); }
  const { data, error } = await admin.rpc("hl7_ingest_lab_results", { target_interface: iface.id, payload: parsed, raw_message: raw });
  if (error) return hl7(ack(parsed.controlId, "AE", error.message, { receivingApplication: parsed.sendingApplication }), 500);
  return hl7(ack(parsed.controlId, data.ack, data.ack === "AA" ? `${data.results_created} result(s) received for validation` : data.error, { receivingApplication: parsed.sendingApplication }));
});
