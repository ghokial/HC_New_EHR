// Sends a facility's monthly aggregate dataValueSet to its DHIS2 instance.
//   POST /dhis2-push  {"facility_id": "...", "period": "YYYYMM", "dry_run": true|false}
// Runs as the signed-in administrator (their session builds the payload under the
// database's rules). The DHIS2 address is the facility's integration_endpoints row of
// type dhis2_web_api; configuration.auth_env names an Edge Function secret holding a
// DHIS2 personal access token (sent as "Authorization: ApiToken <token>").
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return reply({ error: "Sign in required" }, 401);
  const { facility_id, period, dry_run } = await req.json();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await db.auth.getUser();
  if (!user) return reply({ error: "Invalid session" }, 401);
  const { data: payload, error } = await db.rpc("dhis2_data_value_set", { target_facility: facility_id, dhis2_period: period });
  if (error) return reply({ error: error.message }, 400);
  if (dry_run) return reply({ payload });
  const { data: endpoint } = await db.from("integration_endpoints").select("base_url,enabled,configuration").eq("facility_id", facility_id).eq("integration_type", "dhis2_web_api").maybeSingle();
  if (!endpoint?.enabled) return reply({ error: "No enabled DHIS2 Web API endpoint is configured for this facility" }, 400);
  const token = endpoint.configuration?.auth_env ? Deno.env.get(endpoint.configuration.auth_env) : null;
  if (!token) return reply({ error: "The DHIS2 access token secret is not set" }, 400);
  const response = await fetch(`${String(endpoint.base_url).replace(/\/+$/, "")}/api/dataValueSets`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `ApiToken ${token}` }, body: JSON.stringify(payload) });
  const summary = await response.json().catch(() => ({ status: response.status }));
  await db.from("data_export_audit").insert({ facility_id, exported_by: user.id, export_type: "DHIS2", module: "facility_report", filter_parameters: { period, http_status: response.status } });
  return reply({ ok: response.ok, status: response.status, summary, payload }, response.ok ? 200 : 502);
});
