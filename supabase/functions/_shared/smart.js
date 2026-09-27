// SMART on FHIR helpers shared by the Edge Functions and tests. Pure functions.

// PKCE S256: BASE64URL-ENCODE(SHA256(ASCII(code_verifier))) without padding (RFC 7636).
export async function pkceChallenge(verifier) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let binary = ""; for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
// RFC 7636: 43-128 characters from the unreserved set.
export const validVerifier = verifier => /^[A-Za-z0-9\-._~]{43,128}$/.test(String(verifier || ""));

// Does a granted scope list allow reading this resource type in patient context?
export function scopeAllows(scopes, resourceType, action = "read") {
  const want = action === "search" ? ["read", "rs", "s"] : ["read", "rs", "r"];
  return (scopes || []).some(scope => {
    const m = String(scope).match(/^patient\/(\*|[A-Za-z]+)\.(read|rs|r|s)$/);
    return Boolean(m) && (m[1] === "*" || m[1] === resourceType) && want.includes(m[2]);
  });
}

export function smartConfiguration({ authorizeUrl, tokenUrl }) {
  return {
    authorization_endpoint: authorizeUrl,
    token_endpoint: tokenUrl,
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    response_types_supported: ["code"],
    scopes_supported: ["launch/patient", "patient/*.read", "patient/*.rs", ...["Patient", "Encounter", "Observation", "Condition", "MedicationRequest", "AllergyIntolerance", "Immunization"].map(t => `patient/${t}.rs`)],
    capabilities: ["launch-standalone", "client-public", "client-confidential-symmetric", "context-standalone-patient", "permission-patient", "permission-v1", "permission-v2"],
  };
}
