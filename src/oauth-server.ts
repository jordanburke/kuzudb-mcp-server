import express, { Express } from "express"
import { randomBytes } from "crypto"
import { OAuthConfig } from "./server-fastmcp.js"
import { createProxyMiddleware } from "http-proxy-middleware"
import { Server } from "http"

type AuthorizeQuery = {
  response_type?: string
  client_id?: string
  redirect_uri?: string
  scope?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: string
}

type TokenBody = {
  grant_type?: string
  code?: string
  client_id?: string
  client_secret?: string
  redirect_uri?: string
  code_verifier?: string
}

// Store for authorization codes (in production, use Redis or similar)
const authorizationCodes = new Map<
  string,
  {
    clientId?: string
    redirectUri?: string
    codeChallenge?: string
    codeChallengeMethod?: string
    createdAt: number
  }
>()

// Clean up old codes every minute
setInterval(() => {
  const now = Date.now()
  for (const [code, data] of authorizationCodes.entries()) {
    if (now - data.createdAt > 600000) {
      // 10 minutes
      authorizationCodes.delete(code)
    }
  }
}, 60000)

export function createOAuthServer(oauth: OAuthConfig, mcpPort: number): Express {
  const app = express()

  // Add CORS middleware for all OAuth endpoints
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    if (req.method === "OPTIONS") {
      res.sendStatus(200)
      return
    }
    next()
  })

  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // Generate a consistent mock JWKS
  const mockJWKS = {
    keys: [
      {
        kty: "RSA",
        use: "sig",
        kid: "static-key-1",
        alg: "RS256",
        n: "xGOr-H7A-PWG3z" + randomBytes(32).toString("base64url"),
        e: "AQAB",
      },
    ],
  }

  // OAuth Authorization Endpoint (GET and POST)
  const handleAuthorize = (req: express.Request, res: express.Response): express.Response => {
    const params = (req.method === "GET" ? req.query : req.body) as Record<string, unknown>
    const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method } =
      params as AuthorizeQuery

    // Basic validation
    if (response_type !== "code") {
      return res.status(400).json({
        error: "unsupported_response_type",
        error_description: "Only 'code' response type is supported",
      })
    }

    if (!redirect_uri) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "redirect_uri is required",
      })
    }

    // Generate authorization code
    const code = randomBytes(16).toString("hex")

    // Store code with metadata for validation
    authorizationCodes.set(code, {
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      createdAt: Date.now(),
    })

    // For static auth, immediately redirect with the code
    // eslint-disable-next-line no-undef
    const redirectUrl = new URL(redirect_uri)
    redirectUrl.searchParams.set("code", code)
    if (state) {
      redirectUrl.searchParams.set("state", state)
    }

    // Redirect to the callback URL
    res.redirect(302, redirectUrl.toString())
    return res
  }

  app.get("/oauth/authorize", handleAuthorize)
  app.post("/oauth/authorize", handleAuthorize)

  // OAuth Dynamic Client Registration Endpoint (RFC 7591)
  app.post("/oauth/register", (req: express.Request, res: express.Response) => {
    // For static auth, we accept any client registration
    // and return a client_id and client_secret (though we don't validate them)
    const clientId = `client-${randomBytes(8).toString("hex")}`
    const clientSecret = randomBytes(16).toString("hex")

    const body = req.body as Record<string, unknown>

    const registrationResponse = {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0, // Never expires
      redirect_uris: body.redirect_uris || ["http://localhost:6274/oauth/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: body.client_name || "MCP Inspector",
      token_endpoint_auth_method: "client_secret_post",
      scope: body.scope || "read write",
    }

    return res.status(201).json(registrationResponse)
  })

  // OAuth Token Endpoint
  app.post("/oauth/token", (req: express.Request, res: express.Response) => {
    const { grant_type, code, redirect_uri } = req.body as TokenBody

    // Validate grant type
    if (grant_type !== "authorization_code") {
      return res.status(400).json({
        error: "unsupported_grant_type",
        error_description: "Only 'authorization_code' grant type is supported",
      })
    }

    // Validate the authorization code
    const codeData = authorizationCodes.get(code || "")
    if (!codeData) {
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Invalid or expired authorization code",
      })
    }

    // Validate redirect_uri matches
    if (codeData.redirectUri && codeData.redirectUri !== redirect_uri) {
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "redirect_uri mismatch",
      })
    }

    // For PKCE, validate code_verifier (simplified for static auth)
    // In production, you'd properly validate the code challenge

    // Remove used code
    authorizationCodes.delete(code!)

    // Return the static token
    const tokenResponse = {
      access_token: oauth.staticToken,
      token_type: "Bearer",
      expires_in: 31536000, // 1 year
      scope: oauth.staticUser?.scope || "read write",
      refresh_token: oauth.staticToken,
    }

    return res.json(tokenResponse)
  })

  // JWKS Endpoint
  app.get("/oauth/jwks", (_req: express.Request, res: express.Response) => {
    return res.json(mockJWKS)
  })

  app.get("/.well-known/jwks.json", (_req: express.Request, res: express.Response) => {
    return res.json(mockJWKS)
  })

  // OpenID Configuration Discovery - Multiple paths for compatibility
  const openidConfigHandler = (req: express.Request, res: express.Response): express.Response => {
    const protocol = req.get("x-forwarded-proto") || req.protocol
    const host = req.get("host")
    const baseUrl = `${protocol}://${host}`

    return res.json({
      issuer: oauth.authorizationServer?.issuer || baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      jwks_uri: `${baseUrl}/oauth/jwks`,
      response_types_supported: ["code"],
      response_modes_supported: ["query", "fragment"],
      grant_types_supported: ["authorization_code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "profile", "email", "read", "write"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
      claims_supported: ["sub", "email", "name"],
      code_challenge_methods_supported: ["S256", "plain"],
      registration_endpoint: `${baseUrl}/oauth/register`,
    })
  }

  // Register OpenID configuration at multiple paths
  app.get("/.well-known/openid-configuration", openidConfigHandler)
  app.get("/mcp/.well-known/openid-configuration", openidConfigHandler)

  // OAuth Authorization Server Metadata (RFC 8414)
  const oauthServerMetadataHandler = (req: express.Request, res: express.Response): express.Response => {
    const protocol = req.get("x-forwarded-proto") || req.protocol
    const host = req.get("host")
    const baseUrl = `${protocol}://${host}`

    return res.json({
      issuer: oauth.authorizationServer?.issuer || baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      jwks_uri: `${baseUrl}/oauth/jwks`,
      response_types_supported: ["code"],
      response_modes_supported: ["query", "fragment"],
      grant_types_supported: ["authorization_code"],
      scopes_supported: ["read", "write", "admin"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
      code_challenge_methods_supported: ["S256", "plain"],
      registration_endpoint: `${baseUrl}/oauth/register`,
      service_documentation: "https://github.com/jordanburke/kuzudb-mcp-server",
    })
  }

  // Register OAuth server metadata at multiple paths
  app.get("/.well-known/oauth-authorization-server", oauthServerMetadataHandler)
  app.get("/mcp/.well-known/oauth-authorization-server", oauthServerMetadataHandler)

  // Proxy all other requests to the MCP server
  app.use(
    createProxyMiddleware({
      target: `http://localhost:${mcpPort}`,
      changeOrigin: false,
      ws: true,
    }) as express.RequestHandler,
  )

  return app
}

export function startOAuthServer(oauth: OAuthConfig, mcpPort: number, oauthPort: number): Server {
  const app = createOAuthServer(oauth, mcpPort)

  const server = app.listen(oauthPort, () => {
    console.error(`✓ OAuth wrapper server running on port ${oauthPort}`)
    console.error("  OAuth endpoints:")
    console.error(`    - Authorization: http://localhost:${oauthPort}/oauth/authorize`)
    console.error(`    - Token: http://localhost:${oauthPort}/oauth/token`)
    console.error(`    - JWKS: http://localhost:${oauthPort}/oauth/jwks`)
    console.error(`    - Discovery: http://localhost:${oauthPort}/.well-known/openid-configuration`)
    console.error(`  MCP endpoints (proxied from port ${mcpPort}):`)
    console.error(`    - MCP: http://localhost:${oauthPort}/mcp`)
    console.error(`    - Health: http://localhost:${oauthPort}/health`)
  })

  return server
}
