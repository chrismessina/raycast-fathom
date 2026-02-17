# OAuth Migration + SDK Removal Plan

## Overview

Migrate from API Key authentication (user-pasted into Raycast preferences) to OAuth 2 PKCE flow using Raycast's built-in OAuth support. Simultaneously remove the `fathom-typescript` SDK since we already have complete HTTP implementations for all endpoints.

**Goals:**

- Eliminate the "invalid API key" UX problem entirely (OAuth handles auth natively)
- Remove the SDK's silent-auth-failure bug (SDK returns empty results on bad auth)
- Simplify the codebase by removing ~400 lines of SDK wrapper/fallback/converter code
- Follow Raycast OAuth best practices (`OAuthService` + `withAccessToken`)

---

## Prerequisites (User Must Provide)

- [ ] Fathom OAuth Client ID
- [ ] Fathom Authorize URL (e.g. `https://fathom.video/oauth/authorize`)
- [ ] Fathom Token URL (e.g. `https://fathom.video/oauth/token`)
- [ ] Required OAuth scopes
- [ ] Register Raycast's redirect URI with Fathom (get from `OAuth.PKCEClient`)

---

## Phase 1: Create OAuth Auth Module

### Step 1.1: Create `src/fathom/auth.ts`

New file — the single source of truth for authentication.

```ts
import { OAuth } from "@raycast/api";
import { OAuthService, getAccessToken } from "@raycast/utils";

// PKCE client for Fathom
const fathomClient = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: "Fathom",
  providerIcon: "extension-icon.png",
  providerId: "fathom",
  description: "Connect your Fathom account to search meetings, teams, and more.",
});

// OAuthService handles authorize + token refresh automatically
export const fathom = new OAuthService({
  client: fathomClient,
  clientId: "PLACEHOLDER_CLIENT_ID", // ← user provides
  scope: "PLACEHOLDER_SCOPES", // ← user provides
  authorizeUrl: "PLACEHOLDER_AUTH_URL", // ← user provides
  tokenUrl: "PLACEHOLDER_TOKEN_URL", // ← user provides
});

/**
 * Get the current OAuth access token.
 * Works in both React (command) and non-React (tool) contexts.
 * Throws if not authenticated.
 */
export function getFathomToken(): string {
  const { token } = getAccessToken();
  return token;
}
```

### Step 1.2: Add `withAccessToken` to commands

Raycast's `withAccessToken` HOC ensures the OAuth flow runs before the command renders. It shows the "Connect to Fathom" screen automatically if not authenticated.

---

## Phase 2: Rewrite API Layer (HTTP-Only)

### Step 2.1: Rewrite `src/fathom/api.ts`

**Remove:**

- All imports from `./client` (getFathomClient, getApiKey, isApiKeyKnownInvalid, markApiKeyValid, markApiKeyInvalid)
- All imports from `../utils/converters`
- `listMeetings()` SDK try/catch/fallback logic (~50 lines)
- `listTeams()` SDK try/catch/fallback logic (~40 lines)
- `listTeamMembers()` SDK try/catch/fallback logic (~40 lines)

**Change:**

- `authGet()`: Replace `X-Api-Key` header with `Authorization: Bearer <token>` from `getFathomToken()`
- Remove API key validation state checks (fast-fail guards) — OAuth handles this
- Rename `listMeetingsHTTP` → `listMeetings` (it IS the implementation now)
- Rename `listTeamsHTTP` → `listTeams`
- Rename `listTeamMembersHTTP` → `listTeamMembers`

**Keep:**

- `authGet()` with retry/backoff logic (change auth header only)
- All `mapXFromHTTP()` functions (already working)
- `getMeetingSummary()` and `getMeetingTranscript()` (already HTTP-only)
- Rate limit handling, error classification

**New error handling in `authGet()`:**

- 401 → throw `AUTH_EXPIRED` (token expired/revoked, trigger re-auth)
- Remove `API_KEY_INVALID` / `API_KEY_MISSING` error codes

### Step 2.2: Simplified `authGet()` sketch

```ts
import { getFathomToken } from "./auth";

async function authGet<T>(path: string, retryCount = 0): Promise<T> {
  const token = getFathomToken();

  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("AUTH_EXPIRED: Your Fathom session has expired. Please reconnect.");
    }
    // ... keep existing rate limit / retry logic
  }

  return (await res.json()) as T;
}
```

---

## Phase 3: Delete SDK-Related Code

### Step 3.1: Delete `src/fathom/client.ts`

Entire file removed — no more SDK client, API key state machine, or validation cache.

### Step 3.2: Delete `src/utils/converters.ts`

Entire file removed — SDK type converters no longer needed.

### Step 3.3: Remove SDK dependency

```diff
// package.json
- "fathom-typescript": "^0.0.37"
```

Move `@raycast/utils` from devDependencies to dependencies (it's needed at runtime for OAuth).

---

## Phase 4: Update Commands

### Step 4.1: `src/search-meetings.tsx`

```diff
+ import { withAccessToken } from "@raycast/utils";
+ import { fathom } from "./fathom/auth";

- export default function Command() {
+ function Command() {
    // ... existing component code
    // Remove API_KEY_MISSING / API_KEY_INVALID error handling
    // Update error UI: "Connect to Fathom" instead of "Open Extension Preferences"
  }

+ export default withAccessToken(fathom)(Command);
```

### Step 4.2: `src/search-team-members.tsx`

Same pattern — wrap with `withAccessToken(fathom)`.

### Step 4.3: `src/view-action-items.tsx` and `src/view-action-item-detail.tsx`

Same pattern — wrap with `withAccessToken(fathom)`.

---

## Phase 5: Update Tools (AI)

### Step 5.1: `src/tools/list-meetings.ts`, `get-meeting-details.ts`, `list-team-members.ts`

Tools don't use React components, so `withAccessToken` HOC doesn't apply. Instead:

- Import `getFathomToken` from auth module
- The `getAccessToken()` util from `@raycast/utils` works in tool context too (it reads from the same OAuth token store)
- If not authenticated, tools should throw a clear error prompting the user to open the main command first to authenticate

---

## Phase 6: Update Error Handling

### Step 6.1: `src/utils/errorHandling.ts`

**Replace error types:**

```diff
- API_KEY_MISSING = "API_KEY_MISSING",
- API_KEY_INVALID = "API_KEY_INVALID",
+ AUTH_REQUIRED = "AUTH_REQUIRED",
+ AUTH_EXPIRED = "AUTH_EXPIRED",
```

**Update error messages:**

```diff
- title: "API Key Required",
- message: "Please configure your Fathom API Key in Extension Preferences.",
+ title: "Authentication Required",
+ message: "Please connect your Fathom account.",

- title: "Invalid API Key",
- message: "Please check your Fathom API Key in Extension Preferences.",
+ title: "Session Expired",
+ message: "Please reconnect your Fathom account.",
```

**Update `classifyError()`** to detect new error patterns.

---

## Phase 7: Update Configuration

### Step 7.1: `package.json` preferences

```diff
  "preferences": [
-   {
-     "name": "fathomApiKey",
-     "type": "password",
-     "required": true,
-     "title": "Fathom API Key",
-     "description": "Generate in Fathom → Settings → API Access"
-   },
    {
      "name": "exportDirectory",
      ...
    },
    {
      "name": "verboseLogging",
      ...
    }
  ]
```

---

## Phase 8: Update Hooks & Cache

### Step 8.1: `src/hooks/useCachedMeetings.ts`

- Remove any API key error detection
- Update error handling to use new `AUTH_REQUIRED` / `AUTH_EXPIRED` types

### Step 8.2: `src/utils/cacheManager.ts`

- Remove any API key imports from client.ts
- The cache manager calls API functions which now use OAuth internally — should mostly work as-is

### Step 8.3: `src/utils/requestQueue.ts`

- Check for any API key references to update

---

## Phase 9: Cleanup & Documentation

### Step 9.1: Update `README.md`

- Remove "API Key setup" instructions
- Add "Connect to Fathom" OAuth flow description

### Step 9.2: Update/remove docs

- Remove references to API key in `docs/*.md`
- Update `docs/plan.md` OAuth section with real endpoints

### Step 9.3: Run `npm install` and verify build

---

## File Change Summary

| File                               | Action      | Description                         |
| ---------------------------------- | ----------- | ----------------------------------- |
| `src/fathom/auth.ts`               | **CREATE**  | OAuth service + token accessor      |
| `src/fathom/api.ts`                | **REWRITE** | HTTP-only, Bearer token auth        |
| `src/fathom/client.ts`             | **DELETE**  | SDK client + API key state          |
| `src/utils/converters.ts`          | **DELETE**  | SDK type converters                 |
| `src/search-meetings.tsx`          | MODIFY      | Wrap with `withAccessToken`         |
| `src/search-team-members.tsx`      | MODIFY      | Wrap with `withAccessToken`         |
| `src/view-action-items.tsx`        | MODIFY      | Wrap with `withAccessToken`         |
| `src/view-action-item-detail.tsx`  | MODIFY      | Wrap with `withAccessToken`         |
| `src/tools/list-meetings.ts`       | MODIFY      | Use OAuth token                     |
| `src/tools/get-meeting-details.ts` | MODIFY      | Use OAuth token                     |
| `src/tools/list-team-members.ts`   | MODIFY      | Use OAuth token                     |
| `src/utils/errorHandling.ts`       | MODIFY      | Replace API key error types         |
| `src/hooks/useCachedMeetings.ts`   | MODIFY      | Update error handling               |
| `src/utils/cacheManager.ts`        | MODIFY      | Remove client.ts imports            |
| `package.json`                     | MODIFY      | Remove SDK dep, remove API key pref |
| `package-lock.json`                | AUTO        | Regenerated                         |

**Estimated net code change:** Delete ~400 lines, add ~100 lines = **~300 lines removed**

---

## Risks & Mitigations

1. **Fathom OAuth may not support PKCE** → Use Raycast's PKCE proxy if needed
2. **Token refresh behavior unknown** → `OAuthService` handles refresh automatically; test with short-lived tokens
3. **Tools may not have OAuth context** → Verify `getAccessToken()` works in tool execution context; fallback to prompting user to open main command
4. **Existing users lose cached API key** → First launch after update will prompt OAuth connect (one-time migration cost)
5. **Cache manager background refresh** → Needs valid token; if expired, skip refresh silently until next user interaction triggers re-auth
