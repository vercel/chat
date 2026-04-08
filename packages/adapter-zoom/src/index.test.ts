import { describe, it } from "vitest";

// Import will be used in Plans 02 and 03 when stubs become real implementations
// import { createZoomAdapter } from "./index.js";

describe("ZoomAdapter — Webhook Verification (WBHK-01, WBHK-02, WBHK-03)", () => {
  it.todo(
    "WBHK-01: endpoint.url_validation returns { plainToken, encryptedToken } with HTTP 200"
  );
  it.todo("WBHK-02: tampered x-zm-signature returns HTTP 401");
  it.todo("WBHK-02: missing x-zm-signature returns HTTP 401");
  it.todo("WBHK-02: stale timestamp (>5 minutes) returns HTTP 401");
  it.todo("WBHK-03: valid signature with correct raw body passes verification");
});

describe("ZoomAdapter — S2S OAuth Token (AUTH-01, AUTH-02, AUTH-04)", () => {
  it.todo(
    "AUTH-01: getAccessToken calls https://zoom.us/oauth/token?grant_type=client_credentials"
  );
  it.todo("AUTH-02: token is reused within 1-hour TTL");
  it.todo("AUTH-02: new token is fetched after TTL expires");
  it.todo(
    "AUTH-04: token fetch uses grant_type=client_credentials (not account_credentials)"
  );
});

describe("ZoomAdapter — Factory Validation (AUTH-03)", () => {
  it.todo("throws ValidationError when clientId is missing");
  it.todo("throws ValidationError when clientSecret is missing");
  it.todo("throws ValidationError when robotJid is missing");
  it.todo("throws ValidationError when accountId is missing");
  it.todo("throws ValidationError when webhookSecretToken is missing");
});
