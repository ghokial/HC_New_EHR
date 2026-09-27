// SMART on FHIR helpers: PKCE, scope checks, discovery document, and the Edge Function wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pkceChallenge, scopeAllows, smartConfiguration, validVerifier } from "../supabase/functions/_shared/smart.js";

test("PKCE S256 matches the RFC 7636 Appendix B example", async () => {
  assert.equal(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.ok(validVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
  assert.ok(!validVerifier("short")); assert.ok(!validVerifier("x".repeat(129))); assert.ok(!validVerifier("has spaces ".repeat(5)));
});

test("scopes are checked per resource type, in v1 and v2 syntax, read-only", () => {
  assert.ok(scopeAllows(["patient/*.read"], "Condition"));
  assert.ok(scopeAllows(["patient/Observation.rs"], "Observation", "search"));
  assert.ok(scopeAllows(["patient/Observation.r"], "Observation", "read")); assert.ok(!scopeAllows(["patient/Observation.r"], "Observation", "search"));
  assert.ok(!scopeAllows(["patient/Observation.rs"], "Condition"));
  assert.ok(!scopeAllows(["user/*.read"], "Patient"), "user/ scopes are not supported");
  assert.ok(!scopeAllows(["patient/*.write"], "Patient"));
});

test("the discovery document advertises what is actually implemented", () => {
  const c = smartConfiguration({ authorizeUrl: "https://app/smart-authorize.html", tokenUrl: "https://x/functions/v1/smart-token" });
  assert.deepEqual(c.code_challenge_methods_supported, ["S256"]); assert.deepEqual(c.grant_types_supported, ["authorization_code"]);
  assert.ok(c.capabilities.includes("launch-standalone")); assert.ok(c.capabilities.includes("context-standalone-patient"));
  assert.ok(!c.capabilities.includes("launch-ehr"), "EHR launch is not implemented"); assert.ok(!c.scopes_supported.includes("offline_access"), "no refresh tokens");
});

test("the FHIR function pins SMART tokens to their patient and uses the service key only for them", async () => {
  const fhir = await readFile(new URL("../supabase/functions/fhir/index.ts", import.meta.url), "utf8");
  const smartBranch = fhir.indexOf('bearer.startsWith("hcs_")'), serviceKey = fhir.indexOf("SUPABASE_SERVICE_ROLE_KEY");
  assert.ok(smartBranch > 0 && serviceKey > smartBranch && serviceKey < fhir.indexOf("} else {", smartBranch), "service key is used only inside the SMART branch");
  assert.ok(fhir.includes("smart_resolve_token")); assert.ok(fhir.includes("This token is limited to its authorized patient"));
  const token = await readFile(new URL("../supabase/functions/smart-token/index.ts", import.meta.url), "utf8");
  assert.ok(token.includes("pkceChallenge(verifier)")); assert.ok(token.includes("unsupported_grant_type"));
});
