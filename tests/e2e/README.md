# OAuth E2E Testing Guide

This document provides instructions for testing the OAuth authentication features of the kuzudb-mcp-server.

## Prerequisites

1. **Install Playwright** (if not already installed):
```bash
pnpm add -D @playwright/test playwright
npx playwright install
```

2. **Install system dependencies** (Linux/WSL):
```bash
sudo apt-get install libnspr4 libnss3 libasound2t64
```

3. **Build Kuzu native module** (required for pnpm):
```bash
cd node_modules/.pnpm/kuzu@0.11.3/node_modules/kuzu && node install.js
cd - # return to project root
```

## Test Files Overview

| File | Purpose | Status |
|------|---------|--------|
| `oauth-working.spec.ts` | Basic OAuth endpoint verification | ✅ All 6 tests passing |
| `oauth-login.spec.ts` | OAuth authorization flow with login form | ✅ 2/4 passing |
| `oauth-full-flow.spec.ts` | Complete OAuth login to MCP access | ⚠️ OAuth works, MCP requires session |
| `oauth-simple.spec.ts` | Simple authentication tests | ⚠️ Needs session ID updates |
| `oauth-password-grant.spec.ts` | Password grant tests | ❌ Not supported by server |

## Running Tests

### Start Server with OAuth

The server must be running with OAuth credentials configured:

```bash
# Using npm script (recommended)
pnpm serve:test:http:oauth

# Or manually with environment variables
KUZU_OAUTH_ENABLED=true \
KUZU_OAUTH_USERNAME=admin \
KUZU_OAUTH_PASSWORD=secret123 \
KUZU_OAUTH_USER_ID=oauth-admin \
KUZU_OAUTH_EMAIL=admin@example.com \
KUZU_OAUTH_ISSUER=http://localhost:3000 \
KUZU_OAUTH_RESOURCE=http://localhost:3000/mcp \
pnpm serve:test:http
```

### Run All OAuth Tests
```bash
npx playwright test tests/e2e/
```

### Run Specific Test Files
```bash
# Run the working OAuth tests (recommended for verification)
npx playwright test tests/e2e/oauth-working.spec.ts

# Run with detailed output
npx playwright test tests/e2e/oauth-working.spec.ts --reporter=list

# Run in headed mode (see browser)
npx playwright test tests/e2e/oauth-working.spec.ts --headed

# Run specific test by line number
npx playwright test tests/e2e/oauth-working.spec.ts:4
```

### Run with UI Mode
```bash
npx playwright test --ui
```

## OAuth Configuration

The OAuth system uses these credentials (configured in environment variables):

- **Username**: `admin`
- **Password**: `secret123`
- **User ID**: `oauth-admin`
- **Email**: `admin@example.com`

## What's Working

### ✅ OAuth Authentication Flow
1. **Login Form** - Available at `/oauth/authorize?response_type=code&client_id=test&redirect_uri=http://localhost:3000/callback`
2. **Authorization Code** - Generated after successful login
3. **Token Exchange** - POST to `/oauth/token` with authorization code returns JWT
4. **JWT Tokens** - Valid Bearer tokens with 24-hour expiry

### ✅ OAuth Endpoints
- `/oauth/authorize` - Login form and authorization
- `/oauth/token` - Token exchange endpoint
- `/oauth/jwks` - JSON Web Key Set for token validation
- `/admin` - Admin UI (Kuzu Database Manager)
- `/health` - Health check (no auth required)

### ⚠️ Known Issues

1. **MCP Session Requirement**: FastMCP requires a session ID in addition to OAuth tokens. The OAuth authentication works correctly, but MCP endpoints return "No valid session ID provided" error.

2. **Password Grant Not Supported**: The server only supports `authorization_code` and `refresh_token` grant types, not `password` grant.

3. **Response Codes**: Some endpoints return 400 (Bad Request) instead of 401 (Unauthorized) for missing authentication.

## Testing OAuth Manually

### 1. Test Login Form
```bash
curl "http://localhost:3000/oauth/authorize?response_type=code&client_id=test&redirect_uri=http://localhost:3000/callback"
```
Should return HTML with login form.

### 2. Test JWKS Endpoint
```bash
curl http://localhost:3000/oauth/jwks
```
Should return JSON with public keys.

### 3. Test Admin UI
Open in browser: http://localhost:3000/admin

### 4. Test Health Check
```bash
curl http://localhost:3000/health
```
Should return `{"status":"healthy"}`.

## Debugging Tips

1. **Check server logs** - OAuth configuration is printed on startup
2. **Verify environment variables** - Ensure all OAuth variables are set
3. **Check port 3000** - Make sure it's not already in use
4. **Session ID errors** - FastMCP requires special session handling beyond OAuth

## Expected Test Output

When running `oauth-working.spec.ts`, you should see:
```
✓ health endpoint works without auth
✓ MCP endpoint requires authentication
✓ OAuth authorization endpoint is accessible
✓ OAuth token endpoint exists
✓ OAuth JWKS endpoint exists
✓ Admin UI is accessible

6 passed
```

## Future Improvements

1. **Session Management**: Implement proper FastMCP session establishment after OAuth login
2. **Token Refresh**: Add tests for refresh token flow
3. **Error Messages**: Improve error message consistency (use 401 for auth failures)
4. **Password Grant**: Consider adding password grant support for programmatic access

## Troubleshooting

### "Cannot find module kuzu"
```bash
cd node_modules/.pnpm/kuzu@0.11.3/node_modules/kuzu && node install.js
```

### "No tests found"
Ensure you're in the project root directory and the test files exist in `tests/e2e/`.

### Server won't start
- Check if port 3000 is already in use: `lsof -i :3000`
- Kill existing processes: `pnpm kill`
- Verify all OAuth environment variables are set

### Tests timeout
- Increase timeout in test files or playwright.config.ts
- Check if server is responding: `curl http://localhost:3000/health`

## Additional Resources

- [Playwright Documentation](https://playwright.dev/)
- [OAuth 2.0 Specification](https://oauth.net/2/)
- [FastMCP Documentation](https://github.com/jordanburke/fastmcp)
- [Kuzu Database](https://kuzudb.com/)