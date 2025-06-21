import * as kuzu from "kuzu"

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
): Promise<Record<string, unknown>[]> {
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
          result.close()
        }
      }
      return allResults
    } else {
      // Single query result - use original processQueryResults
      return await processQueryResults(queryResult)
    }
  } catch (error) {
    console.error("Batch execution failed, trying individual statements:", error)

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
      throw new Error(`All statements failed:\n${errors.map((e) => `Statement ${e.statement}: ${e.error}`).join("\n")}`)
    }

    return allResults
  }
}

// Enhanced error formatting
export function formatKuzuError(error: unknown): Record<string, unknown> {
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
    }
  }

  return {
    error: "UNKNOWN_ERROR",
    message: String(error),
    type: "unknown",
  }
}
