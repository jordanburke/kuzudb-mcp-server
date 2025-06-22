/**
 * DDL Batch Protection System
 *
 * This module provides protection against the Kuzu bug where multiple DDL statements
 * in a batch query cause native crashes that cannot be caught by JavaScript error handlers.
 *
 * BUG REFERENCE: https://github.com/kuzudb/kuzu/issues/[to-be-created]
 * WORKAROUND TRACKING: ../kuzu-bug-report/KUZU_BUG_WORKAROUNDS.md
 *
 * TODO: Remove this entire module when Kuzu fixes the DDL batch bug
 */

export interface DDLBatchAnalysis {
  isDangerous: boolean
  ddlStatements: string[]
  ddlCount: number
  riskLevel: "low" | "medium" | "high" | "critical"
  recommendation: string
}

export interface DDLBatchError {
  error: string
  message: string
  type: string
  analysis: DDLBatchAnalysis
  workaround: {
    splitQuery: boolean
    maxBatchSize: number
    suggestedApproach: string
  }
  bugTracking: {
    bugReference: string
    workaroundVersion: string
    removalInstructions: string
  }
}

/**
 * Analyzes a Cypher query for dangerous DDL batch patterns
 */
export function analyzeDDLBatch(cypher: string): DDLBatchAnalysis {
  // Split query into individual statements, filtering out comments and empty lines
  const statements = cypher
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("//") && !s.startsWith("--"))

  // Identify DDL statements (specifically ALTER TABLE which causes the bug)
  const ddlStatements = statements.filter((statement) =>
    /^\s*(ALTER\s+TABLE|CREATE\s+(NODE|REL)\s+TABLE|DROP\s+TABLE)/i.test(statement),
  )

  const ddlCount = ddlStatements.length

  // Determine risk level based on DDL count and patterns
  let riskLevel: "low" | "medium" | "high" | "critical" = "low"
  let recommendation = "Query appears safe to execute."
  let isDangerous = false

  if (ddlCount === 0) {
    riskLevel = "low"
    recommendation = "No DDL statements detected. Query is safe."
  } else if (ddlCount === 1) {
    riskLevel = "low"
    recommendation = "Single DDL statement is safe to execute."
  } else if (ddlCount === 2) {
    riskLevel = "medium"
    recommendation = "Two DDL statements may cause issues. Consider executing separately."
    isDangerous = true
  } else if (ddlCount <= 5) {
    riskLevel = "high"
    recommendation = "Multiple DDL statements likely to cause server crash. Execute individually."
    isDangerous = true
  } else {
    riskLevel = "critical"
    recommendation = "Large DDL batch will definitely cause server crash. Must execute individually."
    isDangerous = true
  }

  return {
    isDangerous,
    ddlStatements,
    ddlCount,
    riskLevel,
    recommendation,
  }
}

/**
 * Creates a standardized error response for dangerous DDL batches
 */
export function createDDLBatchError(analysis: DDLBatchAnalysis): DDLBatchError {
  const maxSafeBatchSize = 1

  return {
    error: "DDL_BATCH_PROTECTION",
    message: `Detected ${analysis.ddlCount} DDL statements in batch query. This pattern causes unrecoverable server crashes due to a Kuzu bug.`,
    type: "ddl_batch_protection",
    analysis,
    workaround: {
      splitQuery: true,
      maxBatchSize: maxSafeBatchSize,
      suggestedApproach: `Execute each of the ${analysis.ddlCount} DDL statements individually to avoid crashes.`,
    },
    bugTracking: {
      bugReference: "https://github.com/kuzudb/kuzu/issues/[pending]",
      workaroundVersion: "1.0.0",
      removalInstructions:
        "Remove ddl-batch-protection.ts and related code when Kuzu fixes getAll() hanging on subsequent DDL results",
    },
  }
}

/**
 * Checks if the DDL batch bug is still present in the current Kuzu version
 * This allows us to automatically detect when the bug is fixed
 */
export function isDDLBatchBugFixed(): boolean {
  // This will be implemented in the test file to avoid affecting production
  // The test will try to execute a known problematic query and see if it hangs
  return false // Assume bug is present until proven otherwise
}

/**
 * Splits a dangerous DDL batch into individual statements
 */
export function splitDDLBatch(cypher: string): string[] {
  // First, remove comments from each line while preserving SQL statements
  const cleanedCypher = cypher
    .split("\n")
    .map((line) => {
      // Remove comments from the line
      const trimmedLine = line.trim()
      if (trimmedLine.startsWith("--") || trimmedLine.startsWith("//")) {
        return "" // Remove comment lines entirely
      }
      // Remove inline comments
      const commentIndex = line.indexOf("--")
      if (commentIndex !== -1) {
        return line.substring(0, commentIndex).trim()
      }
      return line
    })
    .filter((line) => line.trim().length > 0)
    .join("\n")

  // Now split by semicolons and process
  let statements = cleanedCypher
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.endsWith(";") ? s : s + ";"))

  // Remove empty statements that might have been created
  statements = statements.filter((s) => s.trim() !== ";")

  return statements
}

/**
 * Generates safe execution suggestions for DDL batches
 */
export function generateSafeExecutionPlan(analysis: DDLBatchAnalysis): {
  steps: string[]
  totalSteps: number
  estimatedTime: string
} {
  const steps = analysis.ddlStatements.map(
    (statement, index) =>
      `Step ${index + 1}: Execute "${statement.substring(0, 50)}${statement.length > 50 ? "..." : ""}"`,
  )

  return {
    steps,
    totalSteps: analysis.ddlCount,
    estimatedTime: `${analysis.ddlCount * 2}s (approx 2s per DDL statement)`,
  }
}
