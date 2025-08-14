/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/require-await */

import { FastMCP } from "@jordanburke/fastmcp"
import { randomBytes } from "crypto"
import { OAuthConfig } from "./server-fastmcp.js"
import { URL, URLSearchParams } from "url"

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

export function setupOAuthRoutes(server: FastMCP, oauth: OAuthConfig): void {
  if (!oauth.enabled || !oauth.staticToken) {
    return
  }

  console.error("🔐 Setting up OAuth routes in FastMCP...")

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
  server.addRoute("GET", "/oauth/authorize", async (req: any, res: any) => {
    const url = new URL(req.url || "", `http://${req.headers.host as string}`)
    const params = Object.fromEntries(url.searchParams)

    const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method } = params

    // Basic validation
    if (response_type !== "code") {
      res.statusCode = 400
      res.setHeader("Content-Type", "application/json")
      res.end(
        JSON.stringify({
          error: "unsupported_response_type",
          error_description: "Only 'code' response type is supported",
        }),
      )
      return
    }

    if (!redirect_uri) {
      res.statusCode = 400
      res.setHeader("Content-Type", "application/json")
      res.end(
        JSON.stringify({
          error: "invalid_request",
          error_description: "redirect_uri is required",
        }),
      )
      return
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

    // Redirect with the code
    const redirectUrl = new URL(redirect_uri)
    redirectUrl.searchParams.set("code", code)
    if (state) {
      redirectUrl.searchParams.set("state", state)
    }

    res.statusCode = 302
    res.setHeader("Location", redirectUrl.toString())
    res.end()
  })

  // OAuth Token Endpoint
  server.addRoute("POST", "/oauth/token", async (req: any, res: any) => {
    let body = ""
    req.on("data", (chunk: any) => (body += chunk as string))
    req.on("end", () => {
      const params = new URLSearchParams(body)
      const grant_type = params.get("grant_type")
      const code = params.get("code")
      const redirect_uri = params.get("redirect_uri")

      // Validate grant type
      if (grant_type !== "authorization_code") {
        res.statusCode = 400
        res.setHeader("Content-Type", "application/json")
        res.end(
          JSON.stringify({
            error: "unsupported_grant_type",
            error_description: "Only 'authorization_code' grant type is supported",
          }),
        )
        return
      }

      // Validate the authorization code
      const codeData = authorizationCodes.get(code || "")
      if (!codeData) {
        res.statusCode = 400
        res.setHeader("Content-Type", "application/json")
        res.end(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid or expired authorization code",
          }),
        )
        return
      }

      // Validate redirect_uri matches
      if (codeData.redirectUri && codeData.redirectUri !== redirect_uri) {
        res.statusCode = 400
        res.setHeader("Content-Type", "application/json")
        res.end(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "redirect_uri mismatch",
          }),
        )
        return
      }

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

      res.statusCode = 200
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify(tokenResponse))
    })
  })

  // OAuth Dynamic Client Registration Endpoint
  server.addRoute("POST", "/oauth/register", async (req: any, res: any) => {
    let body = ""
    req.on("data", (chunk: any) => (body += chunk as string))
    req.on("end", () => {
      const clientId = `client-${randomBytes(8).toString("hex")}`
      const clientSecret = randomBytes(16).toString("hex")

      let requestBody: any = {}
      try {
        requestBody = JSON.parse(body)
      } catch {
        // Ignore parse errors for empty body
      }

      const registrationResponse = {
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0, // Never expires
        redirect_uris: requestBody.redirect_uris || ["http://localhost:6274/oauth/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        client_name: requestBody.client_name || "MCP Inspector",
        token_endpoint_auth_method: "client_secret_post",
        scope: requestBody.scope || "read write",
      }

      res.statusCode = 201
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify(registrationResponse))
    })
  })

  // JWKS Endpoint
  server.addRoute("GET", "/oauth/jwks", async (_req: any, res: any) => {
    res.statusCode = 200
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(mockJWKS))
  })

  server.addRoute("GET", "/.well-known/jwks.json", async (_req: any, res: any) => {
    res.statusCode = 200
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(mockJWKS))
  })

  // OpenID Configuration Discovery
  const openidConfigHandler = async (req: any, res: any): Promise<void> => {
    const protocol = req.headers["x-forwarded-proto"] || (req.connection?.encrypted ? "https" : "http")
    const host = req.headers.host as string
    const baseUrl = `${protocol as string}://${host}`

    const config = {
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
    }

    res.statusCode = 200
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.end(JSON.stringify(config))
  }

  // Register OpenID configuration at multiple paths
  server.addRoute("GET", "/.well-known/openid-configuration", openidConfigHandler)

  server.addRoute("GET", "/mcp/.well-known/openid-configuration", openidConfigHandler)

  // OAuth Authorization Server Metadata
  const oauthServerMetadataHandler = async (req: any, res: any): Promise<void> => {
    const protocol = req.headers["x-forwarded-proto"] || (req.connection?.encrypted ? "https" : "http")
    const host = req.headers.host as string
    const baseUrl = `${protocol as string}://${host}`

    const metadata = {
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
    }

    res.statusCode = 200
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.end(JSON.stringify(metadata))
  }

  // Register OAuth server metadata at multiple paths
  server.addRoute("GET", "/.well-known/oauth-authorization-server", oauthServerMetadataHandler)

  server.addRoute("GET", "/mcp/.well-known/oauth-authorization-server", oauthServerMetadataHandler)

  // Add CORS preflight handler for all OAuth endpoints
  const corsHandler = async (_req: any, res: any): Promise<void> => {
    res.statusCode = 200
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
    res.end()
  }

  // Add CORS OPTIONS handlers (using any cast for OPTIONS if not in HTTPMethod type)
  server.addRoute("OPTIONS" as any, "/oauth/authorize", corsHandler)
  server.addRoute("OPTIONS" as any, "/oauth/token", corsHandler)
  server.addRoute("OPTIONS" as any, "/oauth/register", corsHandler)
  server.addRoute("OPTIONS" as any, "/.well-known/openid-configuration", corsHandler)
  server.addRoute("OPTIONS" as any, "/mcp/.well-known/openid-configuration", corsHandler)

  console.error("✓ OAuth routes configured in FastMCP")
  console.error("  - Authorization: /oauth/authorize")
  console.error("  - Token: /oauth/token")
  console.error("  - Registration: /oauth/register")
  console.error("  - JWKS: /oauth/jwks")
  console.error("  - Discovery: /.well-known/openid-configuration")
}
