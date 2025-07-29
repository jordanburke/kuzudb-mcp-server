import { FastMCP } from "fastmcp"
import { z } from "zod"
import * as kuzu from "kuzu"
import { executeQuery, getSchema, getPrompt, initializeDatabaseManager, DatabaseManager } from "./server-core.js"

export interface FastMCPServerOptions {
  databasePath: string
  isReadOnly: boolean
  port?: number
  endpoint?: string
}

export function createFastMCPServer(options: FastMCPServerOptions): { server: FastMCP; dbManager: DatabaseManager } {
  console.error("🚀 Initializing FastMCP server...")

  // Initialize database
  const dbManager = initializeDatabaseManager(options.databasePath, options.isReadOnly)

  // Create FastMCP server
  const server = new FastMCP({
    name: "kuzu",
    version: "0.1.0",
  })

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
