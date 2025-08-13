import { FastMCP } from "fastmcp"
import { z } from "zod"
import * as kuzu from "kuzu"
import { createDecoder } from "fast-jwt"
import { executeQuery, getSchema, getPrompt, initializeDatabaseManager, DatabaseManager } from "./server-core.js"

interface DecodedJWT {
  sub?: string
  iss?: string
  aud?: string | string[]
  exp?: number
  scope?: string
  scp?: string
  email?: string
  [key: string]: unknown
}

export interface OAuthConfig {
  enabled: boolean
  // Static token mode
  staticToken?: string
  staticUser?: {
    userId: string
    email?: string
    scope?: string
  }
  // JWT mode (optional)
  authorizationServer?: {
    issuer: string
    authorizationEndpoint: string
    tokenEndpoint: string
    jwksUri: string
    responseTypesSupported: string[]
  }
  protectedResource?: {
    resource: string
    authorizationServers: string[]
  }
  audience?: string
  algorithms?: string[]
  cacheTtl?: number
}

export interface FastMCPServerOptions {
  databasePath: string
  isReadOnly: boolean
  port?: number
  endpoint?: string
  oauth?: OAuthConfig
}

export function createFastMCPServer(options: FastMCPServerOptions): { server: FastMCP; dbManager: DatabaseManager } {
  console.error("🚀 Initializing FastMCP server...")

  // Initialize database
  const dbManager = initializeDatabaseManager(options.databasePath, options.isReadOnly)

  // Create FastMCP server
  const server = new FastMCP({
    name: "kuzu",
    version: "0.1.0",
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
    // Configure OAuth if provided
    ...(options.oauth && {
      oauth: {
        enabled: options.oauth.enabled,
        authorizationServer: options.oauth.authorizationServer,
        protectedResource: options.oauth.protectedResource,
      },
      authenticate: (request) => {
        if (!options.oauth?.enabled) {
          return Promise.resolve({})
        }

        const authHeader = request.headers.authorization
        if (!authHeader?.startsWith("Bearer ")) {
          throw new Error("Missing or invalid authorization header")
        }

        const token = authHeader.slice(7) // Remove 'Bearer ' prefix

        try {
          // Static token mode
          if (options.oauth.staticToken) {
            if (token !== options.oauth.staticToken) {
              throw new Error("Invalid static token")
            }

            // Return static user information
            const staticUser = options.oauth.staticUser || { userId: "static-user" }
            return Promise.resolve({
              userId: staticUser.userId,
              email: staticUser.email || "",
              scope: staticUser.scope || "",
              tokenType: "static",
            })
          }

          // JWT mode - requires authorizationServer configuration
          if (!options.oauth.authorizationServer) {
            throw new Error("OAuth configuration incomplete: missing authorizationServer or staticToken")
          }

          // Basic JWT validation without external JWKS for now
          // In a production environment, you would want to verify against JWKS
          const decoder = createDecoder()
          const decoded = decoder(token) as DecodedJWT

          // Basic validation - check if token has required claims
          if (!decoded.sub) {
            throw new Error("Token missing subject claim")
          }

          // Check issuer if configured
          if (options.oauth.authorizationServer.issuer && decoded.iss !== options.oauth.authorizationServer.issuer) {
            throw new Error(`Invalid issuer: ${decoded.iss as string}`)
          }

          // Check audience if configured
          const audience = options.oauth.audience || options.oauth.protectedResource?.resource
          if (audience && decoded.aud !== audience) {
            throw new Error(`Invalid audience: ${decoded.aud as string}`)
          }

          // Check expiration
          const now = Math.floor(Date.now() / 1000)
          if (decoded.exp && decoded.exp < now) {
            throw new Error("Token expired")
          }

          return Promise.resolve({
            userId: decoded.sub,
            scope: (decoded.scope || decoded.scp) as string,
            email: decoded.email as string,
            tokenPayload: decoded,
            tokenType: "jwt",
          })
        } catch (error) {
          console.error("OAuth token validation failed:", error)
          throw error instanceof Error ? error : new Error("Invalid OAuth token")
        }
      },
    }),
  })

  // Add query tool
  server.addTool({
    name: "query",
    description: "Run a Cypher query on the Kuzu database",
    parameters: z.object({
      cypher: z.string().describe("The Cypher query to run"),
    }),
    execute: async (args, context) => {
      try {
        // Log OAuth user if available
        if (context.session && "userId" in context.session && typeof context.session.userId === "string") {
          console.error(`Query executed by user: ${context.session.userId}`)
        }

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
    execute: async (_args, context) => {
      try {
        // Log OAuth user if available
        if (context.session && "userId" in context.session && typeof context.session.userId === "string") {
          console.error(`Schema accessed by user: ${context.session.userId}`)
        }

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
    execute: async (args, context) => {
      const question = args.question
      if (!question) {
        throw new Error("Missing required argument: question")
      }

      try {
        // Log OAuth user if available
        if (context.session && "userId" in context.session && typeof context.session.userId === "string") {
          console.error(`Cypher generation requested by user: ${context.session.userId}`)
        }

        const schema = await getSchema(dbManager.conn)
        return getPrompt(question, schema)
      } catch (error) {
        console.error("Error in generateKuzuCypher prompt:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

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
