import { FastMCP } from "@jordanburke/fastmcp"
import { z } from "zod"
import * as kuzu from "kuzu"
import { executeQuery, getSchema, getPrompt, initializeDatabaseManager, DatabaseManager } from "./server-core.js"
import { randomBytes } from "crypto"
import { URL, URLSearchParams } from "url"
import { getWebUIHTML } from "./web-ui.js"
import { getDatabaseInfo } from "./backup-utils.js"

export interface OAuthConfig {
  enabled: boolean
  staticToken?: string
  staticUser?: {
    userId: string
    email?: string
    scope?: string
  }
  issuer?: string
}

export interface FastMCPServerOptions {
  databasePath: string
  isReadOnly: boolean
  port?: number
  endpoint?: string
  oauth?: OAuthConfig
}

export function createFastMCPServer(options: FastMCPServerOptions): {
  server: FastMCP<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  dbManager: DatabaseManager
} {
  console.error("🚀 Initializing FastMCP server...")

  // Initialize database
  const dbManager = initializeDatabaseManager(options.databasePath, options.isReadOnly)

  // Create FastMCP server configuration
  type AuthSession = {
    userId: string
    email: string
    scope: string
    [key: string]: unknown // Allow additional properties
  }

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

  // Create server with or without OAuth
  const server = options.oauth?.enabled
    ? new FastMCP<AuthSession>({
        ...baseConfig,
        oauth: {
          enabled: true,
          authorizationServer: {
            issuer: options.oauth.issuer || `http://localhost:${options.port || 3000}`,
            authorizationEndpoint: `${options.oauth.issuer || `http://localhost:${options.port || 3000}`}/oauth/authorize`,
            tokenEndpoint: `${options.oauth.issuer || `http://localhost:${options.port || 3000}`}/oauth/token`,
            jwksUri: `${options.oauth.issuer || `http://localhost:${options.port || 3000}`}/oauth/jwks`,
            responseTypesSupported: ["code"],
          },
          protectedResource: {
            resource: "mcp://kuzudb-server",
            authorizationServers: [options.oauth.issuer || `http://localhost:${options.port || 3000}`],
          },
        },
        authenticate: (request) => {
          const authHeader = request.headers?.authorization

          if (!authHeader?.startsWith("Bearer ")) {
            throw new Error("Missing or invalid authorization header")
          }

          const token = authHeader.slice(7) // Remove 'Bearer ' prefix

          // Validate against static token
          if (token !== options.oauth?.staticToken) {
            throw new Error("Invalid token")
          }

          // Return user info from static config - wrap in Promise for sync function
          return Promise.resolve({
            userId: options.oauth?.staticUser?.userId || "static-user",
            email: options.oauth?.staticUser?.email || "",
            scope: options.oauth?.staticUser?.scope || "read write",
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
    execute: async () => {
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
    // Store for authorization codes (in memory, cleared on restart)
    const authorizationCodes = new Map<
      string,
      {
        createdAt: number
        redirectUri?: string
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

    // OAuth Authorization Endpoint
    server.addRoute(
      "GET",
      "/oauth/authorize",
      (req, res) => {
        const params = req.query
        const responseType = params.response_type as string
        const redirectUri = params.redirect_uri as string
        const state = params.state as string

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

        // Generate authorization code
        const code = randomBytes(16).toString("hex")
        authorizationCodes.set(code, {
          createdAt: Date.now(),
          redirectUri,
        })

        // Immediately redirect with code (no user interaction needed for static auth)
        const redirectUrl = new URL(redirectUri)
        redirectUrl.searchParams.set("code", code)
        if (state) {
          redirectUrl.searchParams.set("state", state)
        }

        res.status(302).setHeader("Location", redirectUrl.toString()).end()
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

        if (grantType !== "authorization_code") {
          res.status(400).json({
            error: "unsupported_grant_type",
            error_description: "Only 'authorization_code' grant type is supported",
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

        // Remove used code
        authorizationCodes.delete(code!)

        // Return the static token
        res.json({
          access_token: options.oauth?.staticToken,
          token_type: "Bearer",
          expires_in: 31536000, // 1 year
          scope: options.oauth?.staticUser?.scope || "read write",
          refresh_token: options.oauth?.staticToken,
        })
      },
      { public: true },
    )

    // JWKS Endpoint (mock for static auth)
    server.addRoute(
      "GET",
      "/oauth/jwks",
      (_req, res) => {
        res.json({
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
        })
      },
      { public: true },
    )

    // Dynamic Client Registration (accept any client)
    server.addRoute(
      "POST",
      "/oauth/register",
      (_req, res) => {
        const clientId = `client-${randomBytes(8).toString("hex")}`
        const clientSecret = randomBytes(16).toString("hex")

        res.status(201).json({
          client_id: clientId,
          client_secret: clientSecret,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_secret_expires_at: 0, // Never expires
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post",
        })
      },
      { public: true },
    )

    console.error("✓ OAuth flow endpoints added:")
    console.error(`    - Authorization: http://localhost:${options.port || 3000}/oauth/authorize`)
    console.error(`    - Token: http://localhost:${options.port || 3000}/oauth/token`)
    console.error(`    - JWKS: http://localhost:${options.port || 3000}/oauth/jwks`)
    console.error(`    - Registration: http://localhost:${options.port || 3000}/oauth/register`)
  }

  // Add Admin UI routes
  const webUIEnabled = process.env.KUZU_WEB_UI_ENABLED !== "false"
  if (webUIEnabled) {
    // Redirect root to admin
    server.addRoute(
      "GET",
      "/",
      (_req, res) => {
        res.status(302).setHeader("Location", "/admin").end()
      },
      { public: true },
    )

    // Serve the admin UI
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
