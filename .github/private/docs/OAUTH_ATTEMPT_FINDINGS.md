# OAuth 2 Migration — Attempt Log & Findings

**Date:** 2026-02-13  
**Status:** ❌ Blocked — reverting to API key approach  
**Decision:** Keep HTTP-only (no SDK), but use API key auth instead of OAuth

---

## Background

The original issue: when a user configures an invalid Fathom API key, the extension produces a noisy cascade of errors because:

1. The `fathom-typescript` SDK silently returns empty results (0 meetings) on auth failure instead of throwing
2. The code interprets 0 results as "maybe no data" and falls back to HTTP
3. HTTP gets a 401 → error thrown, but only after SDK noise in the logs
4. Multiple parallel requests (meetings, teams) all repeat this cascade

**Proposed fix:** Migrate from API key to OAuth 2, which would eliminate the "bad key" problem entirely (Raycast handles token lifecycle) and also let us drop the SDK.

## OAuth Implementation Attempts

### Attempt 1: OAuthService with default settings

```typescript
export const fathom = new OAuthService({
  client,
  clientId: CLIENT_ID,
  scope: SCOPE,
  authorizeUrl: AUTHORIZE_URL,
  tokenUrl: TOKEN_URL,
});
```

**Result:** `415 Unsupported Media Type`  
**Cause:** Fathom's token endpoint requires `application/x-www-form-urlencoded` but Raycast's `OAuthService` sends `application/json` by default.

### Attempt 2: OAuthService with `bodyEncoding: "url-encoded"`

```typescript
export const fathom = new OAuthService({
  client,
  clientId: CLIENT_ID,
  scope: SCOPE,
  authorizeUrl: AUTHORIZE_URL,
  tokenUrl: TOKEN_URL,
  bodyEncoding: "url-encoded",
});
```

**Result:** `401 Unauthorized — invalid_client`  
**Cause:** Fathom requires `client_secret` in the token exchange body, but `OAuthService` with PKCE sends `code_verifier` instead. PKCE is a public-client flow; Fathom requires confidential-client auth.

### Attempt 3: Manual token exchange with custom `authorize` function

Bypassed `OAuthService` entirely. Used `OAuth.PKCEClient` for the browser redirect, then handled token exchange manually with `fetch()`:

```typescript
export const fathom = {
  client,
  authorize: authorizeWithFathom, // Custom function
};
```

The custom function sends form-encoded POST with `client_id`, `client_secret`, `code_verifier`, and `redirect_uri`.

**Result:** `401 Unauthorized — invalid_client`  
**Cause:** The only secret available in Fathom's marketplace app settings is a **Webhook Secret** (`whsec_...` prefix), not an OAuth Client Secret. Tried it as `client_secret` but it's not the right credential.

### Attempt 4: Different token endpoint URL

Noticed Fathom's TypeScript example uses `api.fathom.ai` for the token endpoint, not `fathom.video`:

- Authorize: `https://fathom.video/external/v1/oauth2/authorize` (browser)
- Token: `https://api.fathom.ai/external/v1/oauth2/token` (API)

**Result:** Same `401 Unauthorized — invalid_client`  
**Cause:** Even with the correct API domain, the client authentication still fails — the core issue is the missing OAuth Client Secret.

### Attempt 5: PKCE-only (no client_secret)

Tried sending only PKCE `code_verifier` without any `client_secret` to both token endpoint URLs.

**Result:** `401 Unauthorized — invalid_client`  
**Cause:** Fathom's OAuth implementation does not support PKCE for public clients. It requires a confidential client with `client_secret`.

## Key Findings

### 1. Fathom OAuth requires a confidential client

Fathom's OAuth 2 implementation requires `client_secret` in the token exchange. Their TypeScript example confirms this:

```typescript
body: new URLSearchParams({
  grant_type: "authorization_code",
  code,
  redirect_uri: redirectUri,
  client_id: config.FATHOM_CLIENT_ID,
  client_secret: config.FATHOM_CLIENT_SECRET,
}),
```

### 2. No Client Secret available in Fathom's dashboard

The Fathom marketplace application page (https://fathom.video/marketplace_applications/9) shows:
- ✅ Client ID
- ✅ Webhook Secret (`whsec_...`)
- ❌ No OAuth Client Secret visible

The Webhook Secret is for webhook payload signature verification, not OAuth token exchange.

### 3. Fathom's token endpoint requires form-encoded bodies

Both `fathom.video` and `api.fathom.ai` token endpoints return `415 Unsupported Media Type` when sent JSON. Must use `Content-Type: application/x-www-form-urlencoded`.

### 4. OAuthService limitations

Raycast's `OAuthService` does not support:
- Custom token exchange functions (no way to inject `client_secret` into the PKCE token exchange body)
- `extraParameters` only applies to the authorize URL, not the token exchange
- No `clientSecret` property or `tokenBodyParams` option

However, `withAccessToken()` accepts any object with `{ authorize(): Promise<string> }`, so custom flows are possible — if you have valid credentials.

### 5. Redirect URI confirmation

Raycast's `OAuth.PKCEClient` with `redirectMethod: OAuth.RedirectMethod.Web` generates `https://raycast.com/redirect?packageName=Extension`, which matches the registered redirect URI in Fathom.

## What Would Unblock OAuth

1. **Get an OAuth Client Secret from Fathom** — contact Fathom support or check if there's a way to generate one from their developer portal
2. **Or: Fathom adds PKCE support** — for public clients (native apps like Raycast) that can't securely store a client_secret

## Decision: Revert to API Key + HTTP-only

Since OAuth is blocked on missing credentials, we're reverting to the API key approach but keeping the improvements:

- ✅ **SDK removed** — HTTP-only via `authGet()`, eliminating the silent-auth-failure bug
- ✅ **API key validation** — detect invalid keys early, before cascade
- ❌ **OAuth** — deferred until Fathom client secret is available

### What's preserved from this work

The `auth.ts` OAuth code is documented here for future reference. When a `client_secret` becomes available, the manual token exchange approach (Attempt 3) is the correct pattern — it just needs the right credential.

## Files Changed During OAuth Attempt

| File | Change | Reverted? |
|------|--------|-----------|
| `src/fathom/auth.ts` | Created (OAuth service) | Rewritten → API key helper |
| `src/fathom/client.ts` | Deleted (SDK client) | Stays deleted |
| `src/utils/converters.ts` | Deleted (SDK converters) | Stays deleted |
| `src/fathom/api.ts` | Rewritten (HTTP-only + Bearer auth) | Reverted → API key auth |
| `src/search-meetings.tsx` | Added `withAccessToken` | Reverted → preferences |
| `src/search-team-members.tsx` | Added `withAccessToken` | Reverted → preferences |
| `package.json` | Removed SDK + API key pref | Reverted → add API key pref back |
| `src/utils/errorHandling.ts` | Changed error types | Reverted → API key errors |
