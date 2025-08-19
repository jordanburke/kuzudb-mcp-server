#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CallToolRequest,
  GetPromptRequest,
} from "@modelcontextprotocol/sdk/types.js"
import * as kuzu from "kuzu"
import { parseArgs, showHelp, showVersion, inspectDatabase, validateDatabase, initDatabase, runTests } from "./cli.js"
import { execSync } from "child_process"
import * as path from "path"
import * as fs from "fs"
import { promises as fsPromises } from "fs"
import { DatabaseManager, executeQuery, getSchema, getPrompt, initializeDatabaseManager } from "./server-core.js"
import { createFastMCPServer, OAuthConfig } from "./server-fastmcp.js"

// Global database manager (only used for stdio transport)
let dbManager: DatabaseManager | null = null

async function ensureKuzuInstalled(): Promise<void> {
  // Find the kuzu module directory
  let kuzuPath: string | null = null

  // Try to resolve kuzu module path using import.meta.resolve or require.resolve
  try {
    // For ES modules, we can use require.resolve within a try-catch
    // since we're running in Node.js environment with CommonJS interop
    const createRequire = (await import("module")).createRequire
    const require = createRequire(import.meta.url)
    kuzuPath = path.dirname(require.resolve("kuzu"))
    console.error(`🔍 Found kuzu at: ${kuzuPath}`)
  } catch (error) {
    console.error("❌ Kuzu module not found. Please ensure kuzu is installed.")
    console.error("Error details:", error instanceof Error ? error.message : String(error))
    throw new Error("Kuzu module not found")
  }

  // Check if kuzu is properly installed by looking for index.js
  const indexFile = path.join(kuzuPath, "index.js")
  const kuzujsNode = path.join(kuzuPath, "kuzujs.node")

  console.error(`🔍 Checking for index.js at: ${indexFile}`)
  console.error(`🔍 Checking for kuzujs.node at: ${kuzujsNode}`)

  if (fs.existsSync(indexFile) && fs.existsSync(kuzujsNode)) {
    console.error("✓ Kuzu is already properly installed")
    return
  }

  console.error("🔧 Installing kuzu native binaries...")

  // Check if install script exists
  const installScript = path.join(kuzuPath, "install.js")
  console.error(`🔍 Looking for install script at: ${installScript}`)

  if (!fs.existsSync(installScript)) {
    console.error("⚠️  Kuzu install script not found, skipping install")
    return
  }

  try {
    // Change to kuzu directory and run install script
    const originalCwd = process.cwd()
    console.error(`📁 Changing to kuzu directory: ${kuzuPath}`)
    process.chdir(kuzuPath)

    console.error("🚀 Running kuzu install script...")
    execSync("node install.js", { stdio: "inherit" })

    // Change back to original directory
    process.chdir(originalCwd)

    console.error("✓ Kuzu native binaries installed successfully")

    // Verify installation
    if (fs.existsSync(indexFile) && fs.existsSync(kuzujsNode)) {
      console.error("✓ Installation verified - all required files present")
    } else {
      console.error("⚠️  Installation may be incomplete - some files missing")
    }
  } catch (error) {
    console.error("❌ Failed to install kuzu native binaries:", error instanceof Error ? error.message : String(error))
    console.error("This may cause the MCP server to fail at runtime")
    // Don't fail the entire process - let kuzu try to load anyway
  }
}

const server = new Server(
  {
    name: "kuzu",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  },
)

// Early signal handlers (will be overridden later with better cleanup)
process.on("SIGINT", () => {
  process.exit(0)
})

process.on("SIGTERM", () => {
  process.exit(0)
})

server.setRequestHandler(ListToolsRequestSchema, () => {
  return {
    tools: [
      {
        name: "query",
        description: "Run a Cypher query on the Kuzu database",
        inputSchema: {
          type: "object",
          properties: {
            cypher: {
              type: "string",
              description: "The Cypher query to run",
            },
          },
        },
      },
      {
        name: "getSchema",
        description: "Get the schema of the Kuzu database",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest): Promise<any> => {
  // console.error("Tool call received:", JSON.stringify(request.params, null, 2))

  if (!dbManager) {
    throw new Error("Database manager not initialized")
  }

  if (request.params.name === "query") {
    const cypher = request.params.arguments?.cypher as string
    // The SDK expects the result directly without wrapping
    return await executeQuery(cypher, dbManager)
  } else if (request.params.name === "getSchema") {
    try {
      const schema = await getSchema(dbManager.conn)
      return {
        content: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
        isError: false,
      }
    } catch (error) {
      console.error("Error in getSchema tool:", error)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
          },
        ],
        isError: true,
      }
    }
  }
  throw new Error(`Unknown tool: ${request.params.name}`)
})

server.setRequestHandler(ListPromptsRequestSchema, () => {
  return {
    prompts: [
      {
        name: "generateKuzuCypher",
        description: "Generate a Cypher query for Kuzu",
        arguments: [
          {
            name: "question",
            description: "The question in natural language to generate the Cypher query for",
            required: true,
          },
        ],
      },
    ],
  }
})

server.setRequestHandler(GetPromptRequestSchema, async (request: GetPromptRequest) => {
  if (!dbManager) {
    throw new Error("Database manager not initialized")
  }

  if (request.params.name === "generateKuzuCypher") {
    const question = request.params.arguments?.question as string
    if (!question) {
      throw new Error("Missing required argument: question")
    }

    const schema = await getSchema(dbManager.conn)
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: getPrompt(question, schema),
          },
        },
      ],
    }
  }
  throw new Error(`Unknown prompt: ${request.params.name}`)
})

interface ServerOptions {
  databasePath: string
  readonly?: boolean
  transport?: string
  port?: number
  endpoint?: string
  [key: string]: unknown
}

async function startStdioServer(options: ServerOptions): Promise<void> {
  const isReadOnly = options.readonly || process.env.KUZU_READ_ONLY === "true"

  // Initialize database manager
  dbManager = initializeDatabaseManager(options.databasePath, isReadOnly)

  const transport = new StdioServerTransport()

  // Add additional error handling for the transport connection
  try {
    await server.connect(transport)
    console.error("✓ MCP server connected successfully")
  } catch (error) {
    console.error("❌ Failed to connect MCP server:", error)
    // Don't exit, try to continue - this helps with debugging
    throw error
  }
}

async function main(): Promise<void> {
  // Ensure kuzu is properly installed before doing anything
  await ensureKuzuInstalled()

  // Parse command line arguments
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  // Handle CLI commands
  if (options.help) {
    showHelp()
    process.exit(0)
  }

  if (options.version) {
    showVersion()
    process.exit(0)
  }

  if (options.command === "inspect" && options.databasePath) {
    await inspectDatabase(options.databasePath)
    process.exit(0)
  }

  if (options.command === "validate" && options.databasePath) {
    await validateDatabase(options.databasePath)
    process.exit(0)
  }

  if (options.command === "init" && options.databasePath) {
    await initDatabase(options.databasePath, options.template)
    process.exit(0)
  }

  if (options.command === "test") {
    await runTests()
    process.exit(0)
  }

  // Default: Start MCP server
  if (!options.databasePath) {
    // Check if auto-init is enabled (for Smithery or containerized environments)
    if (process.env.KUZU_AUTO_INIT === "true" && process.env.KUZU_MCP_DATABASE_PATH) {
      console.log("🚀 Auto-initialization enabled, checking database...")
      const autoDbPath = process.env.KUZU_MCP_DATABASE_PATH

      try {
        // Check if database exists
        const dbExists = await fsPromises
          .access(autoDbPath)
          .then(() => true)
          .catch(() => false)
        const isEmpty = dbExists ? (await fsPromises.readdir(autoDbPath)).length === 0 : true

        if (!dbExists || isEmpty) {
          console.log("📦 Auto-initializing database...")
          const template = process.env.KUZU_INIT_TEMPLATE || undefined
          await initDatabase(autoDbPath, template)
          console.log("✅ Database auto-initialized successfully!")
        } else {
          console.log("✓ Database already exists")
        }

        options.databasePath = autoDbPath
      } catch (error) {
        console.error("❌ Auto-initialization failed:", error)
        process.exit(1)
      }
    } else {
      console.error("Error: No database path provided.\n")
      console.error("Usage:")
      console.error("  node dist/index.js <database-path> [options]\n")
      console.error("Quick start:")
      console.error("  pnpm serve:test              # Create/use test database (stdio)")
      console.error("  pnpm serve:test:http         # Create/use test database (HTTP)")
      console.error("  pnpm serve:test:inspect      # Test with MCP Inspector\n")
      console.error("Options:")
      console.error("  --transport <stdio|http>     Transport type (default: stdio)")
      console.error("  --port <number>             Port for HTTP server (default: 3000)")
      console.error("  --readonly                  Enable read-only mode\n")
      console.error("For full help: node dist/index.js --help")
      process.exit(1)
    }
  }

  // Apply options from CLI
  if (options.readonly) {
    process.env.KUZU_READ_ONLY = "true"
  }

  // Choose transport based on options
  const transport = options.transport || "stdio"

  if (transport === "http") {
    // Load OAuth configuration from environment variables
    let oauthConfig: OAuthConfig | undefined
    if (process.env.KUZU_OAUTH_ENABLED === "true") {
      const username = process.env.KUZU_OAUTH_USERNAME
      const password = process.env.KUZU_OAUTH_PASSWORD

      if (!username || !password) {
        console.error("❌ OAuth enabled but KUZU_OAUTH_USERNAME and KUZU_OAUTH_PASSWORD are required")
        process.exit(1)
      }

      oauthConfig = {
        enabled: true,
        username,
        password,
        userId: process.env.KUZU_OAUTH_USER_ID || username,
        email: process.env.KUZU_OAUTH_EMAIL,
        issuer: process.env.KUZU_OAUTH_ISSUER || `http://localhost:${options.port || 3000}`,
        resource: process.env.KUZU_OAUTH_RESOURCE,
      }

      console.error("🔐 OAuth enabled with username/password authentication")
      console.error(`   Username: ${oauthConfig.username}`)
      console.error(`   Password length: ${oauthConfig.password.length}`)
      console.error(`   User ID: ${oauthConfig.userId}`)
      console.error(`   Email: ${oauthConfig.email}`)
      console.error(`   Issuer: ${oauthConfig.issuer}`)
      console.error("   ✓ Login form will be shown at authorization endpoint")
    }

    // Load Basic Auth configuration from environment variables
    let basicAuthConfig: { username: string; password: string; userId?: string; email?: string } | undefined
    if (process.env.KUZU_BASIC_AUTH_USERNAME && process.env.KUZU_BASIC_AUTH_PASSWORD) {
      basicAuthConfig = {
        username: process.env.KUZU_BASIC_AUTH_USERNAME,
        password: process.env.KUZU_BASIC_AUTH_PASSWORD,
        userId: process.env.KUZU_BASIC_AUTH_USER_ID,
        email: process.env.KUZU_BASIC_AUTH_EMAIL,
      }

      console.error("🔐 Basic authentication enabled")
      console.error(`   Username: ${basicAuthConfig.username}`)
      console.error(`   User ID: ${basicAuthConfig.userId || basicAuthConfig.username}`)
    }

    // Create FastMCP HTTP server with shared database manager
    const { server: fastMCPServer } = createFastMCPServer({
      databasePath: options.databasePath,
      isReadOnly: options.readonly || process.env.KUZU_READ_ONLY === "true",
      port: options.port,
      endpoint: options.endpoint,
      oauth: oauthConfig,
      basicAuth: basicAuthConfig,
    })

    // Start FastMCP server
    await fastMCPServer.start({
      transportType: "httpStream",
      httpStream: {
        port: options.port || 3000,
        endpoint: (options.endpoint || "/mcp") as `/${string}`,
      },
    })

    console.error(`✓ FastMCP server running on http://0.0.0.0:${options.port || 3000}${options.endpoint || "/mcp"}`)
    console.error("🔌 Connect with StreamableHTTPClientTransport")
  } else {
    // Start stdio server (default)
    // We already checked that databasePath exists above
    await startStdioServer(options as ServerOptions)
  }
}

// Enhanced global error handlers to prevent server crashes
process.on("uncaughtException", (error) => {
  console.error("🚨 UNCAUGHT EXCEPTION - Attempting recovery...")
  console.error("Error:", error)
  console.error("Stack:", error.stack)
  console.error("Error type:", error.constructor.name)

  // Discard potentially corrupted connection references
  if (dbManager && dbManager.conn) {
    console.error("Discarding database connection reference")
    dbManager.conn = null as unknown as kuzu.Connection
  }
  if (dbManager && dbManager.db) {
    console.error("Discarding database instance reference")
    dbManager.db = null as unknown as kuzu.Database
  }

  // Attempt to reinitialize connections for next request
  setTimeout(() => {
    void (() => {
      try {
        if (dbManager && dbManager.currentDatabasePath) {
          console.error("Attempting to reinitialize database connections...")
          const newDbManager = initializeDatabaseManager(dbManager.currentDatabasePath, dbManager.currentIsReadOnly)
          Object.assign(dbManager, newDbManager)
          console.error("✓ Database connections reinitialized after uncaught exception")
        }
      } catch (reinitError) {
        console.error("❌ Failed to reinitialize database connections:", reinitError)
      }
    })()
  }, 1000)

  // Don't exit - try to keep the server running
  console.error("🔄 Server continuing after uncaught exception (connections may be reset)...")
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 UNHANDLED PROMISE REJECTION - Attempting recovery...")
  console.error("Promise:", promise)
  console.error("Reason:", reason)

  // Check if it's a database-related rejection
  if (
    reason instanceof Error &&
    (reason.message.includes("Database") || reason.message.includes("Connection") || reason.message.includes("kuzu"))
  ) {
    console.error("Database-related promise rejection detected - flagging connections for reset")
    // Flag connections as potentially invalid for next health check
    if (dbManager && dbManager.conn) {
      dbManager.conn = null as unknown as kuzu.Connection
    }
    if (dbManager && dbManager.db) {
      dbManager.db = null as unknown as kuzu.Database
    }
  }

  // Don't exit - try to keep the server running
  console.error("🔄 Server continuing after unhandled rejection...")
})

// Handle SIGTERM and SIGINT gracefully
process.on("SIGTERM", () => {
  console.error("Received SIGTERM, shutting down gracefully...")
  // Note: Kuzu doesn't have close() methods
  process.exit(0)
})

process.on("SIGINT", () => {
  console.error("Received SIGINT, shutting down gracefully...")
  // Note: Kuzu doesn't have close() methods
  process.exit(0)
})

main().catch((error) => {
  console.error("Fatal error in main:", error)
  process.exit(1)
})
