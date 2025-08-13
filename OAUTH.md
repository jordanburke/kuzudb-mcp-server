# OAuth Authentication

The Kuzu MCP server supports optional authentication when running in HTTP transport mode. You can choose between static bearer token authentication or full OAuth 2.0 JWT validation.

## Authentication Modes

### Static Bearer Token (Simple)
- **Pre-shared Secret**: Uses a static token for authentication
- **Fast Setup**: Minimal configuration required
- **Perfect for**: Development, internal tools, simple deployments

### JWT Token Validation (Advanced)
- **OAuth 2.0 Compliant**: Validates Bearer tokens in Authorization headers
- **Claims Verification**: Checks issuer, audience, subject, and expiration claims
- **Perfect for**: Production deployments, integration with identity providers

## Common Features
- **User Context**: Provides authenticated user information to tools
- **Audit Logging**: Logs user actions for security monitoring
- **Configurable**: Support for different authentication modes

## Configuration

### Command Line

```bash
# Using CLI flag
npx kuzudb-mcp-server ./my-database --transport http --oauth-config ./oauth.json

# Using environment variable
KUZU_OAUTH_CONFIG=./oauth.json npx kuzudb-mcp-server ./my-database --transport http
```

### Configuration File Format

#### Option 1: Static Bearer Token (Recommended for Development)

Create a simple JSON configuration file (e.g., `oauth-static.json`):

```json
{
  "enabled": true,
  "staticToken": "your-secret-bearer-token-here",
  "staticUser": {
    "userId": "admin",
    "email": "admin@example.com", 
    "scope": "read write admin"
  }
}
```

**Minimal Static Token Config:**
```json
{
  "enabled": true,
  "staticToken": "kuzu-secret-123"
}
```

#### Option 2: Full JWT OAuth 2.0 Configuration

Create a complete OAuth configuration file (e.g., `oauth-jwt.json`):

```json
{
  "enabled": true,
  "authorizationServer": {
    "issuer": "https://auth.example.com",
    "authorizationEndpoint": "https://auth.example.com/oauth/authorize",
    "tokenEndpoint": "https://auth.example.com/oauth/token",
    "jwksUri": "https://auth.example.com/.well-known/jwks.json",
    "responseTypesSupported": ["code"]
  },
  "protectedResource": {
    "resource": "mcp://kuzu-server",
    "authorizationServers": ["https://auth.example.com"]
  },
  "audience": "mcp://kuzu-server",
  "algorithms": ["RS256", "ES256"],
  "cacheTtl": 300000
}
```

### Configuration Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | Yes | Enable/disable OAuth authentication |
| `authorizationServer.issuer` | string | Yes | JWT issuer to validate against |
| `authorizationServer.authorizationEndpoint` | string | Yes | OAuth authorization endpoint |
| `authorizationServer.tokenEndpoint` | string | Yes | OAuth token endpoint |
| `authorizationServer.jwksUri` | string | Yes | JSON Web Key Set URI for signature verification |
| `authorizationServer.responseTypesSupported` | string[] | Yes | Supported OAuth response types |
| `protectedResource.resource` | string | Yes | Resource identifier for this MCP server |
| `protectedResource.authorizationServers` | string[] | Yes | List of trusted authorization servers |
| `audience` | string | No | Expected audience claim (defaults to resource) |
| `algorithms` | string[] | No | Accepted JWT algorithms (defaults to RS256, ES256) |
| `cacheTtl` | number | No | Cache TTL in milliseconds (defaults to 300000) |

## Usage

### Client Authentication

Clients must include a Bearer token in the Authorization header:

```bash
curl -H "Authorization: Bearer <jwt-token>" \\
  -X POST http://localhost:3000/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "query", "arguments": {"cypher": "MATCH (n) RETURN count(n)"}}}'
```

### JWT Token Requirements

The JWT token must include these claims:

- `sub` (subject): User identifier
- `iss` (issuer): Must match configured issuer
- `aud` (audience): Must match configured audience or resource
- `exp` (expiration): Token expiration timestamp
- `scope` or `scp` (optional): User permissions/scopes
- `email` (optional): User email address

### Example JWT Payload

```json
{
  "sub": "user123",
  "iss": "https://auth.example.com",
  "aud": "mcp://kuzu-server",
  "exp": 1640995200,
  "scope": "read write",
  "email": "user@example.com"
}
```

## Security Considerations

### Current Implementation

The current implementation provides **basic JWT validation**:

- ✅ Claims validation (subject, issuer, audience, expiration)
- ✅ Token format validation
- ❌ Signature verification (not implemented yet)

### Production Deployment

For production use, you should:

1. **Implement Signature Verification**: Add JWKS signature validation
2. **Use HTTPS**: Always serve over secure connections
3. **Implement Rate Limiting**: Protect against abuse
4. **Monitor Logs**: Track authentication events
5. **Rotate Secrets**: Regularly update signing keys

### Enhancing Security

To add signature verification, modify the authentication logic in `src/server-fastmcp.ts` to:

```typescript
// Add JWKS signature verification
import { createVerifier } from 'fast-jwt'
import { buildGetJwks } from 'get-jwks'

const getJwks = buildGetJwks({ jwksUri })
const verify = createVerifier({
  key: async (decodedJwt) => {
    const jwk = await getJwks.getJwk({
      kid: decodedJwt.header.kid,
      alg: decodedJwt.header.alg,
    })
    return jwk
  },
  algorithms: ['RS256', 'ES256'],
})

const payload = await verify(token)
```

## Testing

### Without OAuth (Default)

```bash
pnpm serve:test:http
# No authentication required
```

### With OAuth

1. Create test configuration:
```json
{
  "enabled": true,
  "authorizationServer": {
    "issuer": "https://test.example.com",
    "authorizationEndpoint": "https://test.example.com/oauth/authorize",
    "tokenEndpoint": "https://test.example.com/oauth/token",
    "jwksUri": "https://test.example.com/.well-known/jwks.json",
    "responseTypesSupported": ["code"]
  },
  "protectedResource": {
    "resource": "mcp://kuzu-test",
    "authorizationServers": ["https://test.example.com"]
  }
}
```

2. Start server with OAuth:
```bash
pnpm build && node dist/index.js test/test-db --transport http --oauth-config ./oauth-test.json
```

3. Test with curl:
```bash
# Without token (should fail)
curl http://localhost:3000/mcp

# With valid token (should succeed)
curl -H "Authorization: Bearer <valid-jwt>" http://localhost:3000/mcp
```

## Troubleshooting

### Common Issues

1. **"Missing or invalid authorization header"**
   - Ensure `Authorization: Bearer <token>` header is present
   - Check token is not empty or malformed

2. **"Token missing subject claim"**
   - JWT must include `sub` claim
   - Verify token payload structure

3. **"Invalid issuer"**
   - Token `iss` claim must match configured issuer
   - Check OAuth provider configuration

4. **"Invalid audience"**
   - Token `aud` claim must match configured audience/resource
   - Verify client is requesting correct audience

5. **"Token expired"**
   - Token `exp` claim indicates expiration
   - Request fresh token from OAuth provider

### Debug Logging

Enable debug logging to troubleshoot authentication issues:

```bash
DEBUG=* node dist/index.js test/test-db --transport http --oauth-config ./oauth.json
```

The server logs all OAuth-related events:
- Configuration loading
- Authentication attempts
- User actions (with user ID)
- Token validation failures

## Integration Examples

### Auth0

```json
{
  "enabled": true,
  "authorizationServer": {
    "issuer": "https://your-domain.auth0.com/",
    "authorizationEndpoint": "https://your-domain.auth0.com/authorize",
    "tokenEndpoint": "https://your-domain.auth0.com/oauth/token",
    "jwksUri": "https://your-domain.auth0.com/.well-known/jwks.json",
    "responseTypesSupported": ["code"]
  },
  "protectedResource": {
    "resource": "mcp://kuzu-server",
    "authorizationServers": ["https://your-domain.auth0.com/"]
  },
  "audience": "your-api-identifier"
}
```

### Azure AD

```json
{
  "enabled": true,
  "authorizationServer": {
    "issuer": "https://login.microsoftonline.com/{tenant-id}/v2.0",
    "authorizationEndpoint": "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/authorize",
    "tokenEndpoint": "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token",
    "jwksUri": "https://login.microsoftonline.com/{tenant-id}/discovery/v2.0/keys",
    "responseTypesSupported": ["code"]
  },
  "protectedResource": {
    "resource": "mcp://kuzu-server",
    "authorizationServers": ["https://login.microsoftonline.com/{tenant-id}/v2.0"]
  },
  "audience": "api://{client-id}"
}
```

### Google Cloud Identity

```json
{
  "enabled": true,
  "authorizationServer": {
    "issuer": "https://accounts.google.com",
    "authorizationEndpoint": "https://accounts.google.com/o/oauth2/v2/auth",
    "tokenEndpoint": "https://oauth2.googleapis.com/token",
    "jwksUri": "https://www.googleapis.com/oauth2/v3/certs",
    "responseTypesSupported": ["code"]
  },
  "protectedResource": {
    "resource": "mcp://kuzu-server",
    "authorizationServers": ["https://accounts.google.com"]
  },
  "audience": "your-client-id.apps.googleusercontent.com"
}
```