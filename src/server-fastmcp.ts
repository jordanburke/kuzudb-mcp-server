import { FastMCP } from "@jordanburke/fastmcp"
import { z } from "zod"
import * as kuzu from "kuzu"
import { executeQuery, getSchema, getPrompt, initializeDatabaseManager, DatabaseManager } from "./server-core.js"
import { randomBytes, createHash } from "crypto"
import { URL, URLSearchParams } from "url"
import * as jwt from "jsonwebtoken"
import { getWebUIHTML } from "./web-ui.js"
import { getDatabaseInfo, createSimpleArchive, exportDatabase } from "./backup-utils.js"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

export interface OAuthConfig {
  enabled: boolean
  username: string
  password: string
  userId: string
  email?: string
  issuer?: string
  resource?: string
}

interface OAuthClientRegistrationRequest {
  grant_types?: string[]
  response_types?: string[]
  redirect_uris?: string[]
  token_endpoint_auth_method?: string
  client_name?: string
  scope?: string
}

interface OAuthClientRegistrationResponse {
  client_id: string
  client_secret: string
  client_id_issued_at: number
  client_secret_expires_at: number
  grant_types: string[]
  response_types: string[]
  redirect_uris: string[]
  token_endpoint_auth_method: string
  client_name?: string
  scope?: string
}

export interface FastMCPServerOptions {
  databasePath: string
  isReadOnly: boolean
  port?: number
  endpoint?: string
  oauth?: OAuthConfig
  basicAuth?: {
    username: string
    password: string
    userId?: string
    email?: string
  }
}

// JWT secret for token signing/validation
const JWT_SECRET = process.env.KUZU_JWT_SECRET || randomBytes(32).toString("hex")

// In-memory stores for OAuth flow
const authorizationCodes = new Map<
  string,
  {
    createdAt: number
    redirectUri?: string
    codeChallenge?: string
    codeChallengeMethod?: string
    userId: string
  }
>()

const refreshTokens = new Map<
  string,
  {
    createdAt: number
    userId: string
    email?: string
  }
>()

// AuthSession type for FastMCP authentication
type AuthSession = {
  userId: string
  email: string
  scope: string
  [key: string]: unknown // Allow additional properties
}

export function createFastMCPServer(options: FastMCPServerOptions): {
  server: FastMCP<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  dbManager: DatabaseManager
} {
  console.error("🚀 Initializing FastMCP server...")

  // Initialize database
  const dbManager = initializeDatabaseManager(options.databasePath, options.isReadOnly)

  // Create FastMCP server configuration

  // Build server configuration with OAuth if enabled
  const baseConfig = {
    name: "kuzu",
    version: "0.1.0" as const,
    health: {
      enabled: true,
      path: "/health",
      status: 200,
      message: JSON.stringify({
        status: "healthy",
        service: "kuzudb-mcp-server",
        version: "0.11.10",
        database: options.databasePath,
        readonly: options.isReadOnly,
        timestamp: new Date().toISOString(),
      }),
    },
  }

  // Create server with authentication (OAuth, Basic Auth, or none)
  const server =
    options.oauth?.enabled || options.basicAuth
      ? new FastMCP<AuthSession>({
          ...baseConfig,
          oauth: {
            enabled: true,
            authorizationServer: {
              issuer: options.oauth?.issuer || `http://localhost:${options.port || 3000}`,
              authorizationEndpoint: `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/oauth/authorize`,
              tokenEndpoint: `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/oauth/token`,
              jwksUri: `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/oauth/jwks`,
              registrationEndpoint: `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/oauth/register`,
              responseTypesSupported: ["code"],
              grantTypesSupported: ["authorization_code"],
              tokenEndpointAuthMethodsSupported: ["client_secret_post", "client_secret_basic"],
              codeChallengeMethodsSupported: ["S256", "plain"],
            },
            protectedResource: {
              resource:
                process.env.KUZU_OAUTH_RESOURCE ||
                options.oauth?.resource ||
                `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/mcp`,
              authorizationServers: [options.oauth?.issuer || `http://localhost:${options.port || 3000}`],
            },
          },
          authenticate: (request) => {
            const authHeader = request.headers?.authorization
            const baseUrl = options.oauth?.issuer || `http://localhost:${options.port || 3000}`

            // For OAuth-enabled servers, require authentication
            if (!authHeader) {
              if (options.oauth?.enabled) {
                // Return HTTP 401 with WWW-Authenticate header for proper OAuth discovery
                throw new Response(JSON.stringify({
                  error: "unauthorized",
                  error_description: "Authorization required. Please authenticate via OAuth."
                }), {
                  status: 401,
                  statusText: "Unauthorized",
                  headers: {
                    "Content-Type": "application/json",
                    "WWW-Authenticate": `Bearer realm="MCP", authorization_uri="${baseUrl}/oauth/authorize", resource="${baseUrl}/.well-known/oauth-protected-resource"`
                  }
                })
              }
              
              // For non-OAuth servers, also require some form of auth
              throw new Response(JSON.stringify({
                error: "unauthorized",
                error_description: "Authorization required."
              }), {
                status: 401,
                statusText: "Unauthorized",
                headers: {
                  "Content-Type": "application/json"
                }
              })
            }

            // Handle Basic Authentication
            if (options.basicAuth && authHeader.startsWith("Basic ")) {
              const credentials = Buffer.from(authHeader.slice(6), "base64").toString("utf-8")
              const [username, password] = credentials.split(":")

              if (username === options.basicAuth.username && password === options.basicAuth.password) {
                return Promise.resolve({
                  userId: options.basicAuth.userId || username,
                  email: options.basicAuth.email || `${username}@example.com`,
                  scope: "read write",
                })
              } else {
                throw new Response(JSON.stringify({
                  error: "unauthorized",
                  error_description: "Invalid username or password"
                }), {
                  status: 401,
                  statusText: "Unauthorized",
                  headers: {
                    "Content-Type": "application/json",
                    "WWW-Authenticate": `Basic realm="MCP"`
                  }
                })
              }
            }

            // Handle Bearer Token (OAuth) - Validate JWT
            if (options.oauth?.enabled && authHeader.startsWith("Bearer ")) {
              const token = authHeader.slice(7) // Remove 'Bearer ' prefix

              try {
                // Verify JWT token
                const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload

                if (!decoded.sub || !decoded.iat || !decoded.exp) {
                  throw new Response(JSON.stringify({
                    error: "invalid_token",
                    error_description: "Invalid token structure"
                  }), {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {
                      "Content-Type": "application/json",
                      "WWW-Authenticate": `Bearer realm="MCP", error="invalid_token", error_description="Invalid token structure"`
                    }
                  })
                }

                // Validate audience
                const expectedAudience = options.oauth?.resource || `${baseUrl}/mcp`
                if (decoded.aud && decoded.aud !== expectedAudience) {
                  throw new Response(JSON.stringify({
                    error: "invalid_token",
                    error_description: "Token audience mismatch"
                  }), {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {
                      "Content-Type": "application/json",
                      "WWW-Authenticate": `Bearer realm="MCP", error="invalid_token", error_description="Token audience mismatch"`
                    }
                  })
                }

                // Return user info from JWT claims
                return Promise.resolve({
                  userId: decoded.sub,
                  email: (decoded.email as string) || "",
                  scope: (decoded.scope as string) || "read write",
                })
              } catch (error) {
                if (error instanceof Response) {
                  throw error // Re-throw our custom Response errors
                }
                
                throw new Response(JSON.stringify({
                  error: "invalid_token",
                  error_description: "Invalid or expired token"
                }), {
                  status: 401,
                  statusText: "Unauthorized",
                  headers: {
                    "Content-Type": "application/json",
                    "WWW-Authenticate": `Bearer realm="MCP", error="invalid_token", error_description="Invalid or expired token"`
                  }
                })
              }
            }

            throw new Response(JSON.stringify({
              error: "unauthorized",
              error_description: "Invalid authorization header format"
            }), {
              status: 401,
              statusText: "Unauthorized",
              headers: {
                "Content-Type": "application/json",
                "WWW-Authenticate": `Bearer realm="MCP", authorization_uri="${baseUrl}/oauth/authorize", resource="${baseUrl}/.well-known/oauth-protected-resource"`
              }
            })
          },
        })
      : new FastMCP(baseConfig)

  // Add query tool
  server.addTool({
    name: "query",
    description: "Run a Cypher query on the Kuzu database",
    parameters: z.object({
      cypher: z.string().describe("The Cypher query to run"),
    }),
    execute: async (args) => {
      try {
        const result = await executeQuery(args.cypher, dbManager)

        if (result.isError) {
          // FastMCP expects string responses, so we need to format error responses
          // We'll include a special prefix to indicate this is an error
          return `ERROR: ${result.content[0]?.text || "Unknown error"}`
        }

        return result.content[0]?.text || "No result"
      } catch (error) {
        console.error("Error in query tool:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

  // Add getSchema tool
  server.addTool({
    name: "getSchema",
    description: "Get the schema of the Kuzu database",
    parameters: z.object({}),
    execute: async (_args) => {
      try {
        const schema = await getSchema(dbManager.conn)
        return JSON.stringify(schema, null, 2)
      } catch (error) {
        console.error("Error in getSchema tool:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

  // Add generateKuzuCypher prompt
  // Note: FastMCP doesn't support prompts directly, they're implemented as tools
  // that return formatted prompt strings
  server.addTool({
    name: "generateKuzuCypher",
    description: "Generate a Cypher query for Kuzu from natural language",
    parameters: z.object({
      question: z.string().describe("The question in natural language to generate the Cypher query for"),
    }),
    execute: async (args) => {
      const question = args.question
      if (!question) {
        throw new Error("Missing required argument: question")
      }

      try {
        const schema = await getSchema(dbManager.conn)
        return getPrompt(question, schema)
      } catch (error) {
        console.error("Error in generateKuzuCypher prompt:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

  // Add OAuth flow endpoints if OAuth is enabled
  if (options.oauth?.enabled) {
    // Clean up old codes and refresh tokens every minute
    setInterval(() => {
      const now = Date.now()
      // Clean authorization codes (10 minutes)
      for (const [code, data] of authorizationCodes.entries()) {
        if (now - data.createdAt > 600000) {
          authorizationCodes.delete(code)
        }
      }
      // Clean refresh tokens (30 days)
      for (const [token, data] of refreshTokens.entries()) {
        if (now - data.createdAt > 2592000000) {
          // 30 days
          refreshTokens.delete(token)
        }
      }
    }, 60000)

    // OAuth Authorization Endpoint - Login Form
    server.addRoute(
      "GET",
      "/oauth/authorize",
      (req, res) => {
        const params = req.query
        const responseType = params.response_type as string
        const redirectUri = params.redirect_uri as string
        const state = params.state as string
        const codeChallenge = params.code_challenge as string
        const codeChallengeMethod = params.code_challenge_method as string
        const clientId = params.client_id as string

        if (responseType !== "code") {
          res.status(400).json({
            error: "unsupported_response_type",
            error_description: "Only 'code' response type is supported",
          })
          return
        }

        if (!redirectUri) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "redirect_uri is required",
          })
          return
        }

        // Validate PKCE parameters if present
        if (codeChallenge) {
          if (!codeChallengeMethod || !["S256", "plain"].includes(codeChallengeMethod)) {
            res.status(400).json({
              error: "invalid_request",
              error_description: "Invalid code_challenge_method. Only 'S256' and 'plain' are supported",
            })
            return
          }
        }

        // Show the username for login (user ID is only used internally for tokens)
        const usernameHelp = `Username: ${options.oauth?.username}`

        // Serve login form
        const loginForm = `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth Login - Kuzu MCP Server</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="text"], input[type="password"] { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
        button { width: 100%; padding: 12px; background: #007cba; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; }
        button:hover { background: #005a87; }
        .error { color: red; margin-bottom: 10px; }
        .app-info { background: #f5f5f5; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
        .login-help { background: #e8f4f8; padding: 10px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="app-info">
        <h3>🔐 OAuth Authorization</h3>
        <p><strong>Application:</strong> ${clientId || "MCP Client"}</p>
        <p><strong>Permissions:</strong> Read and write access to Kuzu database</p>
    </div>
    
    <div class="login-help">
        <strong>💡 Login Info:</strong><br>
        ${usernameHelp}
    </div>
    
    <form method="POST" action="/oauth/authorize">
        <input type="hidden" name="response_type" value="${responseType}">
        <input type="hidden" name="redirect_uri" value="${redirectUri}">
        <input type="hidden" name="state" value="${state || ""}">
        <input type="hidden" name="code_challenge" value="${codeChallenge || ""}">
        <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod || ""}">
        <input type="hidden" name="client_id" value="${clientId || ""}">
        
        <div class="form-group">
            <label for="username">Username:</label>
            <input type="text" id="username" name="username" required>
        </div>
        
        <div class="form-group">
            <label for="password">Password:</label>
            <input type="password" id="password" name="password" required>
        </div>
        
        <button type="submit">Authorize Application</button>
    </form>
</body>
</html>`

        res.send(loginForm)
      },
      { public: true },
    )

    // OAuth Authorization POST - Process Login
    server.addRoute(
      "POST",
      "/oauth/authorize",
      async (req, res) => {
        try {
          const body = await req.text()
          const params = new URLSearchParams(body)

          const username = params.get("username")
          const password = params.get("password")
          const redirectUri = params.get("redirect_uri")
          const state = params.get("state")
          const codeChallenge = params.get("code_challenge")
          const codeChallengeMethod = params.get("code_challenge_method")

          // Validate credentials - only accept the configured username for login
          if (username !== options.oauth?.username || password !== options.oauth?.password) {
            const errorForm = `
<!DOCTYPE html>
<html><head><title>Login Failed</title><style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:20px;}.error{color:red;background:#fee;padding:10px;border-radius:4px;margin-bottom:15px;}</style></head>
<body><div class="error">❌ Invalid username or password</div><a href="javascript:history.back()">← Try Again</a></body></html>`
            res.status(401).send(errorForm)
            return
          }

          // Generate authorization code
          const code = randomBytes(16).toString("hex")
          authorizationCodes.set(code, {
            createdAt: Date.now(),
            redirectUri: redirectUri || "",
            codeChallenge: codeChallenge || undefined,
            codeChallengeMethod: codeChallengeMethod || undefined,
            userId: options.oauth?.userId || username || "oauth-user",
          })

          // Redirect with authorization code
          const redirectUrl = new URL(redirectUri || "")
          redirectUrl.searchParams.set("code", code)
          if (state) {
            redirectUrl.searchParams.set("state", state)
          }

          res.status(302).setHeader("Location", redirectUrl.toString()).end()
        } catch {
          res.status(400).json({
            error: "invalid_request",
            error_description: "Failed to process authorization request",
          })
        }
      },
      { public: true },
    )

    // OAuth Token Endpoint
    server.addRoute(
      "POST",
      "/oauth/token",
      async (req, res) => {
        const body = await req.text()
        const params = new URLSearchParams(body)
        const grantType = params.get("grant_type")
        const code = params.get("code")
        const redirectUri = params.get("redirect_uri")
        const codeVerifier = params.get("code_verifier")
        const refreshTokenParam = params.get("refresh_token")

        if (grantType === "refresh_token") {
          // Handle refresh token flow
          if (!refreshTokenParam) {
            res.status(400).json({
              error: "invalid_request",
              error_description: "refresh_token is required for refresh_token grant type",
            })
            return
          }

          const tokenData = refreshTokens.get(refreshTokenParam)
          if (!tokenData) {
            res.status(400).json({
              error: "invalid_grant",
              error_description: "Invalid or expired refresh token",
            })
            return
          }

          // Remove old refresh token (token rotation)
          refreshTokens.delete(refreshTokenParam)

          // Generate new JWT access token
          const accessTokenPayload = {
            sub: tokenData.userId,
            email: tokenData.email || "",
            scope: "read write",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 900, // 15 minutes
            iss: options.oauth?.issuer || `http://localhost:${options.port || 3000}`,
            aud:
              options.oauth?.resource || `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/mcp`,
          }

          // Generate new refresh token
          const newRefreshToken = randomBytes(32).toString("hex")
          refreshTokens.set(newRefreshToken, {
            createdAt: Date.now(),
            userId: tokenData.userId,
            email: tokenData.email,
          })

          const accessToken = jwt.sign(accessTokenPayload, JWT_SECRET)

          res.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: 900, // 15 minutes
            scope: "read write",
            refresh_token: newRefreshToken,
          })
          return
        }

        if (grantType !== "authorization_code") {
          res.status(400).json({
            error: "unsupported_grant_type",
            error_description: "Only 'authorization_code' and 'refresh_token' grant types are supported",
          })
          return
        }

        const codeData = authorizationCodes.get(code || "")
        if (!codeData) {
          res.status(400).json({
            error: "invalid_grant",
            error_description: "Invalid or expired authorization code",
          })
          return
        }

        // Validate redirect_uri matches
        if (codeData.redirectUri && codeData.redirectUri !== redirectUri) {
          res.status(400).json({
            error: "invalid_grant",
            error_description: "redirect_uri mismatch",
          })
          return
        }

        // Validate PKCE if code_challenge was provided
        if (codeData.codeChallenge) {
          if (!codeVerifier) {
            res.status(400).json({
              error: "invalid_grant",
              error_description: "code_verifier is required when code_challenge was used",
            })
            return
          }

          let expectedChallenge: string
          if (codeData.codeChallengeMethod === "S256") {
            expectedChallenge = createHash("sha256").update(codeVerifier).digest().toString("base64url")
          } else {
            // 'plain' method
            expectedChallenge = codeVerifier
          }

          if (expectedChallenge !== codeData.codeChallenge) {
            res.status(400).json({
              error: "invalid_grant",
              error_description: "Invalid code_verifier",
            })
            return
          }
        }

        // Remove used code
        authorizationCodes.delete(code!)

        // Generate JWT access token (15 minutes)
        const accessTokenPayload = {
          sub: codeData.userId,
          email: options.oauth?.email || "",
          scope: "read write",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900, // 15 minutes
          iss: options.oauth?.issuer || `http://localhost:${options.port || 3000}`,
          aud: options.oauth?.resource || `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/mcp`,
        }

        // Generate refresh token (7 days)
        const refreshToken = randomBytes(32).toString("hex")
        refreshTokens.set(refreshToken, {
          createdAt: Date.now(),
          userId: codeData.userId,
          email: options.oauth?.email,
        })

        const accessToken = jwt.sign(accessTokenPayload, JWT_SECRET)

        res.json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 900, // 15 minutes
          scope: "read write",
          refresh_token: refreshToken,
        })
      },
      { public: true },
    )

    // JWKS Endpoint - Symmetric key (HMAC)
    server.addRoute(
      "GET",
      "/oauth/jwks",
      (_req, res) => {
        // For HMAC/symmetric keys, JWKS typically returns empty or minimal key info
        // since the secret is shared between client and server, not public
        res.json({
          keys: [
            {
              kty: "oct", // Octet sequence for symmetric keys
              use: "sig",
              kid: "kuzu-hmac-key",
              alg: "HS256",
              // Note: We don't expose the actual secret in JWKS for HMAC
            },
          ],
        })
      },
      { public: true },
    )

    // Dynamic Client Registration (accept any client)
    server.addRoute(
      "POST",
      "/oauth/register",
      async (req, res) => {
        try {
          // Parse the request body to get client registration info
          let registrationRequest: OAuthClientRegistrationRequest = {}

          try {
            // Try to get JSON body directly from req.body if available
            if (req.body && typeof req.body === "object") {
              registrationRequest = req.body as OAuthClientRegistrationRequest
            } else {
              // Fallback to text parsing - handle FastMCP body parsing issues
              const body = await req.text()
              if (body && body !== "[object Object]") {
                try {
                  registrationRequest = JSON.parse(body) as OAuthClientRegistrationRequest
                } catch {
                  // If not JSON, treat as form-encoded (though DCR usually uses JSON)
                  const formData = Object.fromEntries(new URLSearchParams(body))
                  registrationRequest = formData as OAuthClientRegistrationRequest
                }
              }
            }
          } catch (parseError) {
            console.error("Error parsing request body:", parseError)
          }

          const clientId = `client-${randomBytes(8).toString("hex")}`
          const clientSecret = randomBytes(16).toString("hex")

          // Return the registered client with the provided redirect URIs
          const response: OAuthClientRegistrationResponse = {
            client_id: clientId,
            client_secret: clientSecret,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_secret_expires_at: 0, // Never expires
            grant_types: registrationRequest.grant_types || ["authorization_code"],
            response_types: registrationRequest.response_types || ["code"],
            redirect_uris: registrationRequest.redirect_uris || [],
            token_endpoint_auth_method: registrationRequest.token_endpoint_auth_method || "client_secret_post",
          }

          // Add any other fields the client requested
          if (registrationRequest.client_name) {
            response.client_name = registrationRequest.client_name
          }
          if (registrationRequest.scope) {
            response.scope = registrationRequest.scope
          }

          res.status(201).json(response)
        } catch (error) {
          res.status(400).json({
            error: "invalid_client_metadata",
            error_description:
              "Invalid client registration request: " + (error instanceof Error ? error.message : String(error)),
          })
        }
      },
      { public: true },
    )

    console.error("✓ OAuth flow endpoints added:")
    console.error(`    - Authorization: http://localhost:${options.port || 3000}/oauth/authorize`)
    console.error(`    - Token: http://localhost:${options.port || 3000}/oauth/token`)
    console.error(`    - JWKS: http://localhost:${options.port || 3000}/oauth/jwks`)
    console.error(`    - Registration: http://localhost:${options.port || 3000}/oauth/register`)
  }

  // Add root info endpoint for resource discovery
  server.addRoute(
    "GET",
    "/",
    (_req, res) => {
      const baseUrl = options.oauth?.issuer || `http://localhost:${options.port || 3000}`
      
      const serverInfo = {
        name: "Kuzu MCP Server",
        version: "0.11.10",
        description: "Model Context Protocol server for Kuzu graph database operations",
        service: "kuzudb-mcp-server",
        database: {
          path: options.databasePath,
          readonly: options.isReadOnly,
          connected: !!dbManager.conn,
        },
        capabilities: {
          tools: ["query", "getSchema", "generateKuzuCypher"],
          transports: ["stdio", "http"],
          authentication: {
            oauth: options.oauth?.enabled || false,
            basicAuth: !!options.basicAuth,
          },
        },
        endpoints: {
          mcp: `${baseUrl}${options.endpoint || "/mcp"}`,
          health: `${baseUrl}/health`,
          ...(process.env.KUZU_WEB_UI_ENABLED !== "false" && {
            admin: `${baseUrl}/admin`,
            api: {
              info: `${baseUrl}/api/info`,
              health: `${baseUrl}/api/health`,
              backup: `${baseUrl}/api/backup`,
              export: `${baseUrl}/api/export`,
              restore: `${baseUrl}/api/restore`,
            },
          }),
          ...(options.oauth?.enabled && {
            oauth: {
              authorization: `${baseUrl}/oauth/authorize`,
              token: `${baseUrl}/oauth/token`,
              jwks: `${baseUrl}/oauth/jwks`,
              register: `${baseUrl}/oauth/register`,
              discovery: {
                authorizationServer: `${baseUrl}/.well-known/oauth-authorization-server`,
                protectedResource: `${baseUrl}/.well-known/oauth-protected-resource`,
              },
            },
          }),
        },
        documentation: {
          mcp: "https://modelcontextprotocol.io",
          kuzu: "https://kuzudb.com",
          cypher: "https://docs.kuzudb.com/cypher",
        },
        timestamp: new Date().toISOString(),
      }

      res.json(serverInfo)
    },
    { public: true },
  )

  // Add Admin UI routes
  const webUIEnabled = process.env.KUZU_WEB_UI_ENABLED !== "false"
  if (webUIEnabled) {
    // Serve the admin UI at /admin (root now shows server info)
    server.addRoute(
      "GET",
      "/admin",
      (_req, res) => {
        const html = getWebUIHTML({
          databasePath: options.databasePath,
          isReadOnly: options.isReadOnly,
          version: "0.11.10",
        })
        res.send(html)
      },
      { public: true },
    )

    // Database info API endpoint
    server.addRoute(
      "GET",
      "/api/info",
      async (_req, res) => {
        try {
          const info = await getDatabaseInfo(options.databasePath)
          res.json({
            ...info,
            isReadOnly: options.isReadOnly,
            connected: !!dbManager.conn,
          })
        } catch (error) {
          console.error("Error getting database info:", error)
          res.status(500).json({ error: "Failed to get database info" })
        }
      },
      { public: true },
    )

    // Health check for admin UI
    server.addRoute(
      "GET",
      "/api/health",
      (_req, res) => {
        res.json({
          status: "healthy",
          service: "kuzudb-admin-ui",
          database: options.databasePath,
          readonly: options.isReadOnly,
          timestamp: new Date().toISOString(),
        })
      },
      { public: true },
    )

    // Download backup endpoint
    server.addRoute(
      "GET",
      "/api/backup",
      async (_req, res) => {
        try {
          // Create a simple archive in memory
          const archive = await createSimpleArchive(options.databasePath)

          // Set headers for download
          const filename = `kuzu-backup-${new Date().toISOString().slice(0, 10)}.kuzu`
          res.setHeader("Content-Type", "application/octet-stream")
          res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
          res.setHeader("Content-Length", archive.length.toString())

          // Send the archive
          res.send(archive)
        } catch (error) {
          console.error("Error creating backup:", error)
          res.status(500).json({ error: "Failed to create backup" })
        }
      },
      { public: true },
    )

    // Export database endpoint
    server.addRoute(
      "GET",
      "/api/export",
      async (_req, res) => {
        try {
          const exportDir = path.join(os.tmpdir(), `kuzu-export-${Date.now()}`)

          // Export database
          await exportDatabase(dbManager.conn, exportDir)

          // TODO: Create a ZIP of the exported files
          // For now, we'll just return a message
          res.json({
            success: true,
            message: "Export functionality coming soon. Use EXPORT DATABASE command directly for now.",
            exportPath: exportDir,
          })

          // Clean up export directory after some time
          setTimeout(() => {
            void (async () => {
              try {
                await fs.rm(exportDir, { recursive: true, force: true })
              } catch {
                // Ignore cleanup errors
              }
            })()
          }, 60000) // Clean up after 1 minute
        } catch (error) {
          console.error("Error exporting database:", error)
          res.status(500).json({ error: "Failed to export database: " + (error as Error).message })
        }
      },
      { public: true },
    )

    // Restore backup endpoint (simplified - just return not implemented for now)
    server.addRoute(
      "POST",
      "/api/restore",
      (_req, res) => {
        if (options.isReadOnly) {
          res.status(403).json({ error: "Database is in read-only mode" })
          return
        }

        // TODO: Implement full restore functionality with multipart upload
        res.status(501).json({
          error: "Restore functionality not yet implemented in single-port mode",
          message: "Please use the command-line tools for restore operations",
        })
      },
      { public: true },
    )

    console.error("✓ Admin UI added:")
    console.error(`    - Web UI: http://localhost:${options.port || 3000}/admin`)
    console.error(`    - API: http://localhost:${options.port || 3000}/api/*`)
  }

  // Set up global error handlers for the FastMCP server
  process.on("uncaughtException", (error) => {
    console.error("🚨 UNCAUGHT EXCEPTION in FastMCP server - Attempting recovery...")
    console.error("Error:", error)
    console.error("Stack:", error.stack)

    // Discard potentially corrupted connection references
    if (dbManager.conn) {
      console.error("Discarding database connection reference")
      dbManager.conn = null as unknown as kuzu.Connection
    }
    if (dbManager.db) {
      console.error("Discarding database instance reference")
      dbManager.db = null as unknown as kuzu.Database
    }

    // Attempt to reinitialize connections for next request
    setTimeout(() => {
      void (() => {
        try {
          console.error("Attempting to reinitialize database connections...")
          const newDbManager = initializeDatabaseManager(dbManager.currentDatabasePath, dbManager.currentIsReadOnly)
          Object.assign(dbManager, newDbManager)
          console.error("✓ Database connections reinitialized after uncaught exception")
        } catch (reinitError) {
          console.error("❌ Failed to reinitialize database connections:", reinitError)
        }
      })()
    }, 1000)

    console.error("🔄 Server continuing after uncaught exception (connections may be reset)...")
  })

  process.on("unhandledRejection", (reason, promise) => {
    console.error("🚨 UNHANDLED PROMISE REJECTION in FastMCP server - Attempting recovery...")
    console.error("Promise:", promise)
    console.error("Reason:", reason)

    // Check if it's a database-related rejection
    if (
      reason instanceof Error &&
      (reason.message.includes("Database") || reason.message.includes("Connection") || reason.message.includes("kuzu"))
    ) {
      console.error("Database-related promise rejection detected - flagging connections for reset")
      if (dbManager.conn) {
        dbManager.conn = null as unknown as kuzu.Connection
      }
      if (dbManager.db) {
        dbManager.db = null as unknown as kuzu.Database
      }
    }

    console.error("🔄 Server continuing after unhandled rejection...")
  })

  return { server, dbManager }
}

export async function startFastMCPServer(options: FastMCPServerOptions): Promise<void> {
  const { server } = createFastMCPServer(options)

  // Start the server with HTTP streaming transport

  await server.start({
    transportType: "httpStream",
    httpStream: {
      port: options.port || 3000,
      endpoint: (options.endpoint || "/mcp") as `/${string}`,
    },
  })

  console.error(`✓ FastMCP server running on http://0.0.0.0:${options.port || 3000}${options.endpoint || "/mcp"}`)
  console.error("🔌 Connect with StreamableHTTPClientTransport")
}
