// Searches the facility's image archive (PACS) over DICOMweb QIDO-RS for the study that
// matches an imaging order's accession number.
//   GET /dicom-studies?imaging_order={id}   (Authorization: the signed-in user's token)
// The user must be allowed to see the order (checked with their own session). The
// archive address and optional token come from the facility's integration settings.
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { parseStudies, studySearchUrl } from "../_shared/dicomweb.js";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const auth = req.headers.get("Authorization");
  if (!auth) return reply({ error: "Sign in required" }, 401);
  const orderId = Number(new URL(req.url).searchParams.get("imaging_order"));
  if (!Number.isFinite(orderId)) return reply({ error: "imaging_order is required" }, 400);
  const url = Deno.env.get("SUPABASE_URL")!;
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: order, error } = await user.from("imaging_orders").select("id,accession_number,study_instance_uid,orders(patient_id)").eq("id", orderId).maybeSingle();
  if (error) return reply({ error: error.message }, 400);
  if (!order) return reply({ error: "Imaging order not found or not permitted" }, 404);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: config } = await admin.rpc("imaging_archive_config", { target_imaging_order: orderId });
  if (!config?.base_url) return reply({ error: "No image archive (DICOMweb QIDO-RS) is configured for this facility" }, 404);
  const patientId = (order as any).orders?.patient_id;
  const { error: auditError } = await user.rpc("log_patient_record_view", { target_patient: patientId, view_context: "pacs" });
  if (auditError) return reply({ error: `Access could not be recorded in the audit log: ${auditError.message}` }, 403);
  const token = config.auth_env ? Deno.env.get(config.auth_env) : null;
  const response = await fetch(studySearchUrl(config.base_url, order.accession_number), { headers: { Accept: "application/dicom+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (response.status === 204) return reply({ accession_number: order.accession_number, studies: [], viewer_url_template: config.viewer_url_template });
  if (!response.ok) return reply({ error: `The image archive answered ${response.status}` }, 502);
  const studies = parseStudies(await response.json()).filter(s => !s.accessionNumber || s.accessionNumber === order.accession_number);
  return reply({ accession_number: order.accession_number, linked_study: order.study_instance_uid, studies, viewer_url_template: config.viewer_url_template });
});
