import * as kuzu from "kuzu"

// Standard result format for consistency
export interface QueryResultMetadata {
  statementsExecuted: number
  rowsAffected?: number
  executionTime?: string
  success: boolean
}

export interface StandardQueryResult {
  success: boolean
  results: Record<string, unknown>[]
  metadata: QueryResultMetadata
  error?: Record<string, unknown>
}

// Helper to create standardized success response
export function createSuccessResponse(
  results: Record<string, unknown>[],
  metadata: Partial<QueryResultMetadata> = {},
): StandardQueryResult {
  return {
    success: true,
    results,
    metadata: {
      success: true,
      statementsExecuted: metadata.statementsExecuted || 1,
      rowsAffected: metadata.rowsAffected || results.length,
      ...metadata,
    },
  }
}

// Helper to create standardized error response
export function createErrorResponse(
  error: unknown,
  query?: string,
  metadata: Partial<QueryResultMetadata> = {},
): StandardQueryResult {
  const errorInfo = formatKuzuError(error, query)
  return {
    success: false,
    results: [],
    error: errorInfo,
    metadata: {
      success: false,
      statementsExecuted: metadata.statementsExecuted || 0,
      ...metadata,
    },
  }
}

// Helper to create detailed error context
function createErrorContext(
  error: unknown,
  query?: string,
  additionalContext?: Record<string, unknown>,
): Record<string, unknown> {
  const baseError = formatKuzuError(error, query)

  // Add debugging information if it's a result processing error
  if (error instanceof Error && error.message.includes("getAll is not a function")) {
    return {
      ...baseError,
      error: "RESULT_PROCESSING_ERROR",
      message: "Failed to process results from multi-statement query",
      debug: {
        errorType: error.constructor.name,
        errorMessage: error.message,
        queryProvided: !!query,
        statementCount: query ? query.split(";").filter((s) => s.trim()).length : 0,
        ...additionalContext,
      },
    }
  }

  return {
    ...baseError,
    ...(additionalContext && { debug: additionalContext }),
  }
}

// Helper function to process multiple query results
export async function processQueryResults(
  queryResult: kuzu.QueryResult | kuzu.QueryResult[],
): Promise<Record<string, unknown>[]> {
  // Check if the result is an array (multiple query results)
  if (Array.isArray(queryResult)) {
    const allResults: Record<string, unknown>[] = []
    for (let i = 0; i < queryResult.length; i++) {
      const result = queryResult[i]
      if (!result) continue
      try {
        const rows = await result.getAll()
        // For CREATE statements, rows will be empty
        // Add a success indicator for each statement
        if (rows.length === 0) {
          allResults.push({
            statement: i + 1,
            result: "Success",
            rowsAffected: 0,
          })
        } else {
          // For queries with actual results, include the data
          allResults.push(...rows)
        }
        result.close()
      } catch (err) {
        console.error("Error processing individual query result:", err)
        result.close()
      }
    }
    return allResults
  } else {
    // Single query result
    try {
      const rows = await queryResult.getAll()
      queryResult.close()
      return rows
    } catch (err) {
      queryResult.close()
      throw err
    }
  }
}

// Helper function to split and execute queries separately if batch fails
export async function executeBatchQuery(
  connection: kuzu.Connection,
  cypher: string,
  options: { standardFormat?: boolean } = {},
): Promise<Record<string, unknown>[] | StandardQueryResult> {
  const startTime = Date.now()
  try {
    // First try to execute as a single batch
    const queryResult = await connection.query(cypher)

    // If it's an array, we know it's a multi-statement query
    // We need to check if we should add query info to the results
    if (Array.isArray(queryResult)) {
      // Parse the query to get individual statements for better reporting
      const statements = cypher
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      const allResults: Record<string, unknown>[] = []
      const queryResults = queryResult as kuzu.QueryResult[]
      for (let i = 0; i < queryResults.length; i++) {
        const result = queryResults[i]
        if (!result) continue
        try {
          const rows = await result.getAll()
          if (rows.length === 0) {
            // For CREATE/UPDATE/DELETE statements with no results
            allResults.push({
              statement: i + 1,
              query: statements[i] || `Statement ${i + 1}`,
              result: "Success",
              rowsAffected: 0,
            })
          } else {
            // For queries with actual results, include statement info
            allResults.push(
              ...rows.map((row) => ({
                statement: i + 1,
                ...row,
              })),
            )
          }
          result.close()
        } catch (err) {
          console.error("Error processing individual query result:", err)
          // Log more details about the error for debugging
          if (err instanceof Error && err.message.includes("getAll")) {
            console.error("Result object type:", typeof result)
            console.error("Result object properties:", Object.getOwnPropertyNames(result))
            console.error("Result prototype methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(result)))
          }
          result.close()
        }
      }

      if (options.standardFormat) {
        return createSuccessResponse(allResults, {
          statementsExecuted: statements.length,
          executionTime: `${Date.now() - startTime}ms`,
        })
      }
      return allResults
    } else {
      // Single query result - use original processQueryResults
      const results = await processQueryResults(queryResult)
      if (options.standardFormat) {
        return createSuccessResponse(results, {
          statementsExecuted: 1,
          executionTime: `${Date.now() - startTime}ms`,
        })
      }
      return results
    }
  } catch (error) {
    console.error("Batch execution failed, trying individual statements:", error)

    // Check if this is specifically a composite primary key error
    if (cypher && detectCompositePrimaryKey(cypher)) {
      const errorContext = createErrorContext(error, cypher, {
        suggestedFix: "Use a single-column primary key instead",
        example: "CREATE NODE TABLE Test(id SERIAL, col1 INT64, col2 INT64, PRIMARY KEY(id))",
      })
      throw new Error(JSON.stringify(errorContext))
    }

    // If batch fails, split by semicolon and execute individually
    const statements = cypher
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    if (statements.length <= 1) {
      // If there's only one statement, re-throw the original error
      throw error
    }

    const allResults: Record<string, unknown>[] = []
    const errors: Array<{ statement: number; query: string; error: string }> = []

    for (let i = 0; i < statements.length; i++) {
      try {
        const result = await connection.query(statements[i]!)
        const rows = await result.getAll()
        result.close()

        // Add statement info to results
        if (rows.length === 0) {
          allResults.push({
            statement: i + 1,
            query: statements[i]!,
            result: "Success",
            rowsAffected: 0,
          })
        } else {
          allResults.push(
            ...rows.map((row: Record<string, unknown>) => ({
              statement: i + 1,
              ...row,
            })),
          )
        }
      } catch (err) {
        const errorInfo = {
          statement: i + 1,
          query: statements[i]!,
          error: err instanceof Error ? err.message : String(err),
        }
        errors.push(errorInfo)
        allResults.push(errorInfo)
      }
    }

    // If all statements failed, throw an aggregated error
    if (errors.length === statements.length) {
      if (options.standardFormat) {
        return createErrorResponse(
          new Error(`All statements failed:\n${errors.map((e) => `Statement ${e.statement}: ${e.error}`).join("\n")}`),
          cypher,
          { statementsExecuted: 0, executionTime: `${Date.now() - startTime}ms` },
        )
      }
      throw new Error(`All statements failed:\n${errors.map((e) => `Statement ${e.statement}: ${e.error}`).join("\n")}`)
    }

    if (options.standardFormat) {
      return createSuccessResponse(allResults, {
        statementsExecuted: statements.length - errors.length,
        executionTime: `${Date.now() - startTime}ms`,
      })
    }
    return allResults
  }
}

// Helper function to detect composite primary key syntax
export function detectCompositePrimaryKey(query: string): boolean {
  // Detect patterns like: PRIMARY KEY(col1, col2)
  const compositeKeyRegex = /PRIMARY\s+KEY\s*\(\s*\w+\s*,\s*\w+/i
  return compositeKeyRegex.test(query)
}

// Enhanced error formatting
export function formatKuzuError(error: unknown, query?: string): Record<string, unknown> {
  if (error instanceof Error) {
    const errorMessage = error.message

    // Check for specific Kuzu error patterns
    if (errorMessage.includes("duplicated primary key")) {
      const match = errorMessage.match(/Found duplicated primary key value ([^,]+)/)
      return {
        error: "PRIMARY_KEY_VIOLATION",
        message: errorMessage,
        type: "constraint_violation",
        value: match ? match[1] : undefined,
        originalError: errorMessage,
      }
    }

    if (errorMessage.includes("Parser exception")) {
      const match = errorMessage.match(/Parser exception: (.+) \(line: (\d+), offset: (\d+)\)/)
      if (match) {
        // Check if this is a composite primary key error
        if (query && detectCompositePrimaryKey(query)) {
          return {
            error: "UNSUPPORTED_FEATURE",
            message: "Kuzu does not support composite primary keys. Please use a single-column primary key.",
            type: "unsupported_feature",
            suggestion: "Consider concatenating columns or using a SERIAL primary key with a unique constraint.",
            documentation: "https://kuzudb.com/docs/cypher/data-definition/create-table",
            line: parseInt(match[2]!),
            offset: parseInt(match[3]!),
            originalError: errorMessage,
          }
        }
        return {
          error: "PARSER_ERROR",
          message: match[1]!,
          type: "syntax_error",
          line: parseInt(match[2]!),
          offset: parseInt(match[3]!),
          originalError: errorMessage,
        }
      }
    }

    if (errorMessage.includes("Runtime exception")) {
      return {
        error: "RUNTIME_ERROR",
        message: errorMessage.replace("Runtime exception: ", ""),
        type: "runtime_error",
        originalError: errorMessage,
      }
    }

    // Default error format
    return {
      error: "QUERY_ERROR",
      message: errorMessage,
      type: "unknown",
      originalError: errorMessage,
      ...(query && { query: query.substring(0, 200) + (query.length > 200 ? "..." : "") }),
    }
  }

  return {
    error: "UNKNOWN_ERROR",
    message: String(error),
    type: "unknown",
    ...(query && { query: query.substring(0, 200) + (query.length > 200 ? "..." : "") }),
  }
}
