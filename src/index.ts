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
import { executeBatchQuery, formatKuzuError, detectCompositePrimaryKey } from "./query-helpers.js"
import { execSync } from "child_process"
import * as path from "path"
import * as fs from "fs"
import { LockManager, detectMutation, LockTimeoutError } from "./lock-manager.js"

interface TableInfo {
  name: string
  type: string
  isPrimaryKey: boolean
}

interface NodeTable {
  name: string
  comment: string
  properties: TableInfo[]
}

interface RelTable {
  name: string
  comment: string
  properties: Omit<TableInfo, "isPrimaryKey">[]
  connectivity: Array<{
    src: string
    dst: string
  }>
}

interface Schema {
  nodeTables: NodeTable[]
  relTables: RelTable[]
}

const TABLE_TYPES = {
  NODE: "NODE",
  REL: "REL",
} as const

const bigIntReplacer = (_: string, value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString()
  }
  return value
}

async function ensureKuzuInstalled(): Promise<void> {
  // Find the kuzu module directory
  let kuzuPath: string | null = null

  // Try to resolve kuzu module path using import.meta.resolve or require.resolve
  try {
    // For ES modules, we can use require.resolve within a try-catch
    // since we're running in Node.js environment with CommonJS interop
    const createRequire = (await import("module")).createRequire
    const require = createRequire(import.meta.url)
    kuzuPath = path.dirname(require.resolve("kuzu/package.json"))
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

// Global variables for database connection
let db: kuzu.Database
let conn: kuzu.Connection
let lockManager: LockManager | null = null
let currentDatabasePath: string = ""
let currentIsReadOnly: boolean = false

// Helper to check if connection is still valid
async function isConnectionValid(): Promise<boolean> {
  if (!conn) return false
  try {
    // Try a simple query to test the connection
    const result = await conn.query("RETURN 1 as test;")
    const rows = await result.getAll()
    result.close()
    return rows.length === 1 && rows[0]?.test === 1
  } catch (error) {
    console.error("Connection validation failed:", error)
    return false
  }
}

// Helper to reconnect to the database
async function reconnectDatabase(databasePath: string, isReadOnly: boolean): Promise<void> {
  console.error("Attempting to reconnect to database...")
  try {
    // Note: Kuzu doesn't have close() methods on Connection/Database
    // Simply discard old references and let GC handle cleanup
    conn = null as unknown as kuzu.Connection
    db = null as unknown as kuzu.Database

    // Create new connections
    db = new kuzu.Database(databasePath, 0, true, isReadOnly)
    conn = new kuzu.Connection(db)

    // Validate the new connection
    if (await isConnectionValid()) {
      console.error("Database reconnection successful")
    } else {
      throw new Error("Failed to validate reconnected database")
    }
  } catch (error) {
    console.error("Failed to reconnect to database:", error)
    throw error
  }
}

// Early signal handlers (will be overridden later with better cleanup)
process.on("SIGINT", () => {
  process.exit(0)
})

process.on("SIGTERM", () => {
  process.exit(0)
})

const getPrompt = (question: string, schema: Schema): string => {
  const prompt = `Task:Generate Kuzu Cypher statement to query a graph database.
Instructions:
Generate the Kuzu dialect of Cypher with the following rules in mind:
1. It is recommended to always specifying node and relationship labels explicitly in the \`CREATE\` and \`MERGE\` clause. If not specified, Kuzu will try to infer the label by looking at the schema.
2. \`FINISH\` is recently introduced in GQL and adopted by Neo4j but not yet supported in Kuzu. You can use \`RETURN COUNT(*)\` instead which will only return one record.
3. \`FOREACH\` is not supported. You can use \`UNWIND\` instead.
4. Kuzu can scan files not only in the format of CSV, so the \`LOAD CSV FROM\` clause is renamed to \`LOAD FROM\`.
5. Relationship cannot be omitted. For example \`--\`, \`-- > \` and \`< --\` are not supported. You need to use \` - [] - \`, \` - [] -> \` and \` < -[] -\` instead.
6. Neo4j adopts trail semantic (no repeated edge) for pattern within a \`MATCH\` clause. While Kuzu adopts walk semantic (allow repeated edge) for pattern within a \`MATCH\` clause. You can use \`is_trail\` or \`is_acyclic\` function to check if a path is a trail or acyclic.
7. Since Kuzu adopts trail semantic by default, so a variable length relationship needs to have a upper bound to guarantee the query will terminate. If upper bound is not specified, Kuzu will assign a default value of 30.
8. To run algorithms like (all) shortest path, simply add \`SHORTEST\` or \`ALL SHORTEST\` between the kleene star and lower bound. For example,  \`MATCH(n) - [r * SHORTEST 1..10] -> (m)\`. It is recommended to use \`SHORTEST\` if paths are not needed in the use case.
9. \`REMOVE\` is not supported. Use \`SET n.prop = NULL\` instead.
10. Properties must be updated in the form of \`n.prop = expression\`. Update all properties with map of \` +=\` operator is not supported. Try to update properties one by one.
11. \`USE\` graph is not supported. For Kuzu, each graph is a database.
12. Using \`WHERE\` inside node or relationship pattern is not supported, e.g. \`MATCH(n: Person WHERE a.name = 'Andy') RETURN n\`. You need to write it as \`MATCH(n: Person) WHERE n.name = 'Andy' RETURN n\`.
13. Filter on node or relationship labels is not supported, e.g. \`MATCH (n) WHERE n:Person RETURN n\`. You need to write it as \`MATCH(n: Person) RETURN n\`, or \`MATCH(n) WHERE label(n) = 'Person' RETURN n\`.
14. Any \`SHOW XXX\` clauses become a function call in Kuzu. For example, \`SHOW FUNCTIONS\` in Neo4j is equivalent to \`CALL show_functions() RETURN *\` in Kuzu.
15. Kuzu supports \`EXISTS\` and \`COUNT\` subquery.
16. \`CALL <subquery>\` is not supported.

Use only the provided node types, relationship types and properties in the schema.
Do not use any other node types, relationship types or properties that are not provided explicitly in the schema.
Schema:
${JSON.stringify(schema, null, 2)}
Note: Do not include any explanations or apologies in your responses.
Do not respond to any questions that might ask anything else than for you to construct a Cypher statement.
Do not include any text except the generated Cypher statement.

The question is:
${question}
`
  return prompt
}

const getSchema = async (connection: kuzu.Connection): Promise<Schema> => {
  try {
    const result = await connection.query("CALL show_tables() RETURN *;")
    const tables = await result.getAll()
    result.close()
    const nodeTables: NodeTable[] = []
    const relTables: RelTable[] = []

    for (const table of tables) {
      const tableInfoResult = await connection.query(`CALL TABLE_INFO('${String(table.name)}') RETURN *;`)
      const tableInfo = await tableInfoResult.getAll()
      tableInfoResult.close()

      const properties = tableInfo.map((property) => ({
        name: property.name as string,
        type: property.type as string,
        isPrimaryKey: property["primary key"] as boolean,
      }))

      if (table.type === TABLE_TYPES.NODE) {
        const nodeTable: NodeTable = {
          name: table.name as string,
          comment: table.comment as string,
          properties,
        }
        nodeTables.push(nodeTable)
      } else if (table.type === TABLE_TYPES.REL) {
        const propertiesWithoutPrimaryKey = properties.map(({ name, type }) => ({
          name,
          type,
        }))

        const connectivityResult = await connection.query(`CALL SHOW_CONNECTION('${String(table.name)}') RETURN *;`)
        const connectivity = await connectivityResult.getAll()
        connectivityResult.close()

        const relTable: RelTable = {
          name: table.name as string,
          comment: table.comment as string,
          properties: propertiesWithoutPrimaryKey,
          connectivity: connectivity.map((c) => ({
            src: c["source table name"] as string,
            dst: c["destination table name"] as string,
          })),
        }
        relTables.push(relTable)
      }
    }

    nodeTables.sort((a, b) => a.name.localeCompare(b.name))
    relTables.sort((a, b) => a.name.localeCompare(b.name))
    return { nodeTables, relTables }
  } catch (error) {
    console.error("Error getting schema:", error)
    throw new Error(`Failed to get schema: ${error instanceof Error ? error.message : String(error)}`)
  }
}

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

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  console.error("Tool call received:", JSON.stringify(request.params, null, 2))

  if (request.params.name === "query") {
    const cypher = request.params.arguments?.cypher as string
    console.error("DEBUG: Query received with cypher:", cypher)
    console.error("DEBUG: typeof cypher:", typeof cypher)
    console.error("DEBUG: cypher === null:", cypher === null)
    console.error("DEBUG: cypher === undefined:", cypher === undefined)
    console.error("DEBUG: Full arguments:", JSON.stringify(request.params.arguments, null, 2))

    if (!cypher) {
      throw new Error(`Invalid cypher query: ${cypher}`)
    }

    try {
      // Early detection of composite primary keys
      if (detectCompositePrimaryKey(cypher)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "UNSUPPORTED_FEATURE",
                  message: "Kuzu does not support composite primary keys. Please use a single-column primary key.",
                  type: "unsupported_feature",
                  suggestion: "Consider using a SERIAL primary key or concatenating columns into a single key.",
                  example: "CREATE NODE TABLE Test(id SERIAL, col1 INT64, col2 INT64, PRIMARY KEY(id))",
                  documentation: "https://kuzudb.com/docs/cypher/data-definition/create-table",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        }
      }

      // Check if query is a write operation in read-only mode
      const isReadOnly = process.env.KUZU_READ_ONLY === "true"
      const isWriteQuery = detectMutation(cypher)

      if (isReadOnly && isWriteQuery) {
        throw new Error("Cannot execute write queries in read-only mode")
      }

      // Handle multi-agent coordination for write queries
      let lock = null
      if (isWriteQuery && lockManager) {
        try {
          lock = await lockManager.acquireWriteLock()
        } catch (error) {
          if (error instanceof LockTimeoutError) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "LOCK_TIMEOUT",
                      message: error.message,
                      type: "lock_timeout",
                      suggestion:
                        "Please try again in a few moments. Another agent is currently writing to the database.",
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            }
          }
          throw error
        }
      }

      try {
        // Enhanced error handling with configurable retry logic
        const maxRetries = parseInt(process.env.KUZU_MAX_RETRIES || "2", 10)
        let rows: Record<string, unknown>[] | undefined = undefined
        let lastError: Error | null = null

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            // Check connection health before executing (except on first attempt if no prior errors)
            if (attempt > 0 || lastError) {
              console.error(`Attempt ${attempt + 1}/${maxRetries + 1}: Checking connection health...`)
              if (!(await isConnectionValid())) {
                console.error("Connection invalid, attempting to reconnect...")
                await reconnectDatabase(currentDatabasePath, currentIsReadOnly)

                // Wait with exponential backoff between reconnection attempts
                if (attempt > 0) {
                  const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
                  console.error(`Waiting ${backoffMs}ms before retry...`)
                  await new Promise((resolve) => setTimeout(resolve, backoffMs))
                }
              }
            }

            rows = (await executeBatchQuery(conn, cypher)) as Record<string, unknown>[]

            // Success! Break out of retry loop
            if (attempt > 0) {
              console.error(`Query succeeded on attempt ${attempt + 1}`)
            }
            break
          } catch (execError) {
            lastError = execError instanceof Error ? execError : new Error(String(execError))
            console.error(`Attempt ${attempt + 1}/${maxRetries + 1} failed:`, lastError.message)

            // Check if this is a connection-related error worth retrying
            const isConnectionError =
              lastError.message.includes("Connection") ||
              lastError.message.includes("Database") ||
              lastError.message.includes("closed") ||
              lastError.message.includes("getAll timeout")

            if (!isConnectionError || attempt >= maxRetries) {
              // Either not a connection error, or we've exhausted retries
              if (attempt >= maxRetries && isConnectionError) {
                // Final connection failure - inform the LLM clearly
                return {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(
                        {
                          error: "CONNECTION_RECOVERY_FAILED",
                          message: `Database connection could not be restored after ${maxRetries + 1} attempts. The MCP server may need to be restarted.`,
                          type: "connection_failure",
                          attempts: attempt + 1,
                          maxRetries: maxRetries + 1,
                          lastError: lastError.message,
                          suggestion: "Please restart Claude Desktop or check the database server status.",
                          recovery: "Connection recovery failed after multiple attempts",
                        },
                        null,
                        2,
                      ),
                    },
                  ],
                  isError: true,
                }
              } else {
                // Non-connection error, re-throw immediately
                throw lastError
              }
            }

            // Continue to next retry attempt for connection errors
            console.error(`Will retry connection error (attempt ${attempt + 1}/${maxRetries + 1})`)
          }
        }

        // Ensure we have rows (this should never happen if we reach here, but TypeScript needs the check)
        if (!rows) {
          throw new Error("Query execution failed - no rows returned")
        }

        // Ensure consistent response format
        const responseData = rows.length === 0 ? [{ result: "Query executed successfully", rowsAffected: 0 }] : rows

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(responseData, bigIntReplacer, 2),
            },
          ],
          isError: false,
        }
      } finally {
        if (lock && lockManager) {
          try {
            await lockManager.releaseLock(lock)
          } catch (releaseError) {
            console.error("Error releasing lock:", releaseError)
          }
        }
      }
    } catch (error) {
      console.error("Query execution error:", error)
      const formattedError = formatKuzuError(error, cypher)

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedError, null, 2),
          },
        ],
        isError: true,
      }
    }
  } else if (request.params.name === "getSchema") {
    try {
      const schema = await getSchema(conn)
      return {
        content: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
        isError: false,
      }
    } catch (error) {
      console.error("Error in getSchema tool:", error)
      const formattedError = formatKuzuError(error)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedError, null, 2),
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
  if (request.params.name === "generateKuzuCypher") {
    const question = request.params.arguments?.question as string
    if (!question) {
      throw new Error("Missing required argument: question")
    }

    const schema = await getSchema(conn)
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
    console.error("Error: Database path is required")
    showHelp()
    process.exit(1)
  }

  // Apply options from CLI
  if (options.readonly) {
    process.env.KUZU_READ_ONLY = "true"
  }

  // Initialize database for MCP server
  const isReadOnly = options.readonly || process.env.KUZU_READ_ONLY === "true"
  currentDatabasePath = options.databasePath
  currentIsReadOnly = isReadOnly
  db = new kuzu.Database(options.databasePath, 0, true, isReadOnly)
  conn = new kuzu.Connection(db)

  // Initialize lock manager if multi-agent mode is enabled
  const multiAgentMode = process.env.KUZU_MULTI_AGENT === "true"
  if (multiAgentMode) {
    const agentId = process.env.KUZU_AGENT_ID || `unknown-${process.pid}`
    const lockTimeout = process.env.KUZU_LOCK_TIMEOUT ? parseInt(process.env.KUZU_LOCK_TIMEOUT, 10) : 10000
    lockManager = new LockManager(options.databasePath, agentId, lockTimeout)
    console.error(`🔐 Multi-agent mode enabled for agent: ${agentId}`)
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// Global error handlers to prevent server crashes
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error)
  console.error("Stack:", error.stack)
  // Note: Kuzu doesn't have close() methods, just discard references
  if (conn) {
    conn = null as unknown as kuzu.Connection
  }
  if (db) {
    db = null as unknown as kuzu.Database
  }
  // Don't exit - try to keep the server running
  console.error("Server continuing after uncaught exception...")
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise)
  console.error("Reason:", reason)
  // Don't exit - try to keep the server running
  console.error("Server continuing after unhandled rejection...")
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
