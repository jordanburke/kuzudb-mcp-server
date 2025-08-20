import * as kuzu from "kuzu"
import { LockManager, detectMutation, LockTimeoutError } from "./lock-manager.js"
import { executeBatchQuery, formatKuzuError, detectCompositePrimaryKey } from "./query-helpers.js"
import { validateMergeQuery, clearSchemaCache } from "./merge-validation.js"

export interface TableInfo {
  name: string
  type: string
  isPrimaryKey: boolean
}

export interface NodeTable {
  name: string
  comment: string
  properties: TableInfo[]
}

export interface RelTable {
  name: string
  comment: string
  properties: Omit<TableInfo, "isPrimaryKey">[]
  connectivity: Array<{
    src: string
    dst: string
  }>
}

export interface Schema {
  nodeTables: NodeTable[]
  relTables: RelTable[]
}

export const TABLE_TYPES = {
  NODE: "NODE",
  REL: "REL",
} as const

export const bigIntReplacer = (_: string, value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString()
  }
  return value
}

export interface DatabaseManager {
  db: kuzu.Database
  conn: kuzu.Connection
  lockManager: LockManager | null
  currentDatabasePath: string
  currentIsReadOnly: boolean
}

export async function isConnectionValid(conn: kuzu.Connection): Promise<boolean> {
  if (!conn) return false
  try {
    const result = await conn.query("RETURN 1 as test;")
    const rows = await result.getAll()
    result.close()
    return rows.length === 1 && rows[0]?.test === 1
  } catch (error) {
    console.error("Connection validation failed:", error)
    return false
  }
}

export async function reconnectDatabase(dbManager: DatabaseManager): Promise<void> {
  console.error("Attempting to reconnect to database...")
  try {
    // Note: Kuzu doesn't have close() methods on Connection/Database
    // Simply discard old references and let GC handle cleanup
    dbManager.conn = null as unknown as kuzu.Connection
    dbManager.db = null as unknown as kuzu.Database

    // Create new connections
    dbManager.db = new kuzu.Database(dbManager.currentDatabasePath, 0, true, dbManager.currentIsReadOnly)
    dbManager.conn = new kuzu.Connection(dbManager.db)

    // Validate the new connection
    if (await isConnectionValid(dbManager.conn)) {
      console.error("Database reconnection successful")
    } else {
      throw new Error("Failed to validate reconnected database")
    }
  } catch (error) {
    console.error("Failed to reconnect to database:", error)
    throw error
  }
}

export async function getSchema(connection: kuzu.Connection): Promise<Schema> {
  try {
    const result = await connection.query("CALL show_tables() RETURN *;")
    const tables = await result.getAll()
    const nodeTables: NodeTable[] = []
    const relTables: RelTable[] = []
    const resultsToClose: kuzu.QueryResult[] = [result]

    for (const table of tables) {
      const tableInfoResult = await connection.query(`CALL TABLE_INFO('${String(table.name)}') RETURN *;`)
      const tableInfo = await tableInfoResult.getAll()
      resultsToClose.push(tableInfoResult)

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
        resultsToClose.push(connectivityResult)

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

    // Close all results after consuming everything
    for (const res of resultsToClose) {
      try {
        res.close()
      } catch (closeErr) {
        console.error("Error closing result:", closeErr)
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

export function getPrompt(question: string, schema: Schema): string {
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

export interface QueryResult {
  content: Array<{
    type: string
    text: string
  }>
  isError: boolean
}

export async function executeQuery(cypher: string, dbManager: DatabaseManager): Promise<QueryResult> {
  console.error("DEBUG: Query received with cypher:", cypher)
  console.error("DEBUG: typeof cypher:", typeof cypher)
  console.error("DEBUG: cypher === null:", cypher === null)
  console.error("DEBUG: cypher === undefined:", cypher === undefined)

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

    // Validate MERGE operations to prevent crashes from undefined properties
    if (cypher.toUpperCase().includes("MERGE")) {
      console.error("🔍 Validating MERGE query...")
      const mergeValidation = await validateMergeQuery(dbManager.conn, cypher)

      if (!mergeValidation.isValid) {
        console.error(`🚨 MERGE VALIDATION: Query contains undefined properties`)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "MERGE_VALIDATION_ERROR",
                  message: "MERGE query validation failed due to undefined properties",
                  type: "schema_validation_error",
                  errors: mergeValidation.errors,
                  warnings: mergeValidation.warnings,
                  suggestion: mergeValidation.suggestedFix,
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

      // Show warnings even if valid
      if (mergeValidation.warnings.length > 0) {
        console.error("⚠️  MERGE warnings:", mergeValidation.warnings.join("; "))
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
    if (isWriteQuery && dbManager.lockManager) {
      try {
        lock = await dbManager.lockManager.acquireWriteLock()
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
            if (!(await isConnectionValid(dbManager.conn))) {
              console.error("Connection invalid, attempting to reconnect...")
              await reconnectDatabase(dbManager)

              // Wait with exponential backoff between reconnection attempts
              if (attempt > 0) {
                const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
                console.error(`Waiting ${backoffMs}ms before retry...`)
                await new Promise((resolve) => setTimeout(resolve, backoffMs))
              }
            }
          }

          rows = (await executeBatchQuery(dbManager.conn, cypher)) as Record<string, unknown>[]

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
            lastError.message.includes("getAll timeout") ||
            lastError.message.includes("Parser exception") ||
            lastError.message.includes("Binder exception")

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
                        message: `Database connection could not be restored after ${
                          maxRetries + 1
                        } attempts. The MCP server may need to be restarted.`,
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

      // Ensure we have rows
      if (!rows) {
        throw new Error("Query execution failed - no rows returned")
      }

      // Clear schema cache after DDL operations
      const isDDLQuery = /^\s*(CREATE|ALTER|DROP)\s+(TABLE|NODE|REL|RELATIONSHIP)/i.test(cypher)
      if (isDDLQuery) {
        console.error("🔄 Clearing schema cache after DDL operation")
        clearSchemaCache()
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
      if (lock && dbManager.lockManager) {
        try {
          await dbManager.lockManager.releaseLock(lock)
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
}

export function initializeDatabaseManager(databasePath: string, isReadOnly: boolean): DatabaseManager {
  const db = new kuzu.Database(databasePath, 0, true, isReadOnly)
  const conn = new kuzu.Connection(db)

  // Initialize lock manager if multi-agent mode is enabled
  let lockManager: LockManager | null = null
  const multiAgentMode = process.env.KUZU_MULTI_AGENT === "true"
  if (multiAgentMode) {
    const agentId = process.env.KUZU_AGENT_ID || `unknown-${process.pid}`
    const lockTimeout = process.env.KUZU_LOCK_TIMEOUT ? parseInt(process.env.KUZU_LOCK_TIMEOUT, 10) : 10000
    lockManager = new LockManager(databasePath, agentId, lockTimeout)
    console.error(`🔐 Multi-agent mode enabled for agent: ${agentId}`)
  }

  return {
    db,
    conn,
    lockManager,
    currentDatabasePath: databasePath,
    currentIsReadOnly: isReadOnly,
  }
}
