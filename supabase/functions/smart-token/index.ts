// SMART on FHIR token endpoint (authorization_code grant with PKCE S256).
// Accepts application/x-www-form-urlencoded as the SMART App Launch spec requires.
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { pkceChallenge, validVerifier } from "../_shared/smart.js";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Content-Type": "application/json", "Cache-Control": "no-store", "Pragma": "no-cache" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "invalid_request", error_description: "Use POST" }, 405);
  const form = new URLSearchParams(await req.text());
  // Confidential clients may authenticate with HTTP Basic instead of form fields.
  let clientId = form.get("client_id") || "", clientSecret = form.get("client_secret");
  const basic = req.headers.get("Authorization")?.match(/^Basic\s+(.+)$/i);
  if (basic) { const [id, secret] = atob(basic[1]).split(":"); clientId = decodeURIComponent(id); clientSecret = decodeURIComponent(secret || ""); }
  if (form.get("grant_type") !== "authorization_code") return reply({ error: "unsupported_grant_type" }, 400);
  const code = form.get("code"), redirect = form.get("redirect_uri"), verifier = form.get("code_verifier");
  if (!code || !redirect || !clientId) return reply({ error: "invalid_request", error_description: "code, redirect_uri, and client_id are required" }, 400);
  if (!validVerifier(verifier)) return reply({ error: "invalid_request", error_description: "A valid PKCE code_verifier is required" }, 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.rpc("smart_redeem_code", { presented_code: code, target_client: clientId, presented_redirect: redirect, verifier_challenge: await pkceChallenge(verifier), presented_secret: clientSecret || null });
  if (error) return reply({ error: "server_error", error_description: error.message }, 500);
  if (data?.error) return reply(data, data.error === "invalid_client" ? 401 : 400);
  return reply(data);
});
