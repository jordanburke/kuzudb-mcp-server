import * as kuzu from "kuzu"

export interface MergeValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  suggestedFix?: string
}

export interface NodePropertyInfo {
  tableName: string
  properties: Set<string>
}

// Cache for node table properties to avoid repeated schema queries
const schemaCache = new Map<string, NodePropertyInfo>()
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Extract MERGE statements from a query
export function extractMergeStatements(query: string): Array<{ label: string; properties: string[] }> {
  const mergeStatements: Array<{ label: string; properties: string[] }> = []

  // Match MERGE patterns like: MERGE (alias:Label {prop: value})
  const mergeRegex = /MERGE\s*\(\s*(\w+)\s*:\s*(\w+)\s*\{([^}]+)\}/gi

  let match
  while ((match = mergeRegex.exec(query)) !== null) {
    const [, , label, propertiesStr] = match
    if (label && propertiesStr) {
      // Extract property names from the properties string
      const propertyRegex = /(\w+)\s*:/g
      const properties: string[] = []
      let propMatch
      while ((propMatch = propertyRegex.exec(propertiesStr)) !== null) {
        const propName = propMatch[1]
        if (propName) {
          properties.push(propName)
        }
      }
      mergeStatements.push({ label, properties })
    }
  }

  // Also check for SET operations after MERGE
  // First, find all MERGE statements with their aliases
  const mergeAliasMap = new Map<string, string>()
  const mergeAliasRegex = /MERGE\s*\(\s*(\w+)\s*:\s*(\w+)/gi
  let aliasMatch
  while ((aliasMatch = mergeAliasRegex.exec(query)) !== null) {
    const [, alias, label] = aliasMatch
    if (alias && label) {
      mergeAliasMap.set(alias, label)
    }
  }

  // Now find all SET properties
  const setPropertyRegex = /(\w+)\.(\w+)\s*=/g
  let propMatch
  while ((propMatch = setPropertyRegex.exec(query)) !== null) {
    const [, alias, property] = propMatch
    if (alias && property) {
      const label = mergeAliasMap.get(alias)
      if (label) {
        const existingMerge = mergeStatements.find((m) => m.label === label)
        if (existingMerge && !existingMerge.properties.includes(property)) {
          existingMerge.properties.push(property)
        } else if (!existingMerge) {
          mergeStatements.push({ label, properties: [property] })
        }
      }
    }
  }

  return mergeStatements
}

// Get properties for a node table from schema
export async function getNodeTableProperties(
  connection: kuzu.Connection,
  tableName: string,
  forceRefresh = false,
): Promise<Set<string> | null> {
  // Check cache first
  const now = Date.now()
  if (!forceRefresh && now - cacheTimestamp < CACHE_TTL) {
    const cached = schemaCache.get(tableName.toLowerCase())
    if (cached) {
      return cached.properties
    }
  }

  try {
    // Query table info
    const result = await connection.query(`CALL TABLE_INFO('${tableName}') RETURN *;`)
    const tableInfo = await result.getAll()
    result.close()

    if (tableInfo.length === 0) {
      return null // Table doesn't exist
    }

    const properties = new Set<string>()
    for (const prop of tableInfo) {
      if (prop.name && typeof prop.name === "string") {
        properties.add(prop.name)
      }
    }

    // Update cache
    schemaCache.set(tableName.toLowerCase(), {
      tableName,
      properties,
    })
    cacheTimestamp = now

    return properties
  } catch (error) {
    console.error(`Failed to get properties for table ${tableName}:`, error)
    return null
  }
}

// Validate MERGE operations in a query
export async function validateMergeQuery(connection: kuzu.Connection, query: string): Promise<MergeValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  // Extract MERGE statements
  const mergeStatements = extractMergeStatements(query)

  if (mergeStatements.length === 0) {
    return { isValid: true, errors, warnings }
  }

  // Validate each MERGE statement
  for (const merge of mergeStatements) {
    const schemaProperties = await getNodeTableProperties(connection, merge.label)

    if (schemaProperties === null) {
      errors.push(`Node table '${merge.label}' does not exist. Create it first with CREATE NODE TABLE.`)
      continue
    }

    // Check each property
    const undefinedProperties: string[] = []
    for (const prop of merge.properties) {
      if (!schemaProperties.has(prop)) {
        undefinedProperties.push(prop)
      }
    }

    if (undefinedProperties.length > 0) {
      const propList = undefinedProperties.join(", ")
      const availableProps = Array.from(schemaProperties).join(", ")
      errors.push(
        `Properties [${propList}] are not defined in node table '${merge.label}'. ` +
          `Available properties: [${availableProps}]`,
      )
    }
  }

  // Add general warning about MERGE limitations
  if (mergeStatements.length > 0) {
    warnings.push(
      "MERGE has limited support in Kuzu. Consider using CREATE OR REPLACE for updates, " +
        "or MATCH then CREATE for conditional creation.",
    )
  }

  // Suggest alternative pattern if errors exist
  let suggestedFix: string | undefined
  if (errors.length > 0) {
    suggestedFix =
      "To fix this issue:\n" +
      "1. Ensure all properties are defined in the CREATE NODE TABLE statement\n" +
      "2. Or use CREATE OR REPLACE instead of MERGE for updates\n" +
      "3. Or use MATCH/CREATE pattern for conditional creation\n\n" +
      "Example alternatives:\n" +
      "- CREATE OR REPLACE (node:Label {id: value, prop: value})\n" +
      "- MATCH (node:Label {id: value}) SET node.prop = value\n" +
      "- CREATE (node:Label {id: value}) // if doesn't exist"
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    suggestedFix,
  }
}

// Clear the schema cache (useful after DDL operations)
export function clearSchemaCache(): void {
  schemaCache.clear()
  cacheTimestamp = 0
}

// Convert MERGE to safer alternatives
export function convertMergeToSafePattern(query: string): string {
  // This is a simplified converter - in production, you'd want a proper parser
  let converted = query

  // Convert MERGE (n:Label {id: value}) to CREATE OR REPLACE
  converted = converted.replace(/MERGE\s*\((\w+):(\w+)\s*\{([^}]+)\}\)/gi, "CREATE OR REPLACE ($1:$2 {$3})")

  return converted
}
