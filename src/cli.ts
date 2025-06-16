import { Database, Connection } from "kuzu"
import * as path from "path"
import * as fs from "fs/promises"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"

// Read version from package.json
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageJson = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf-8")) as { version: string }
const version = packageJson.version

interface CLIOptions {
  command?: string
  databasePath?: string
  template?: string
  readonly?: boolean
  timeout?: number
  maxResults?: number
  help?: boolean
  version?: boolean
}

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true
        break

      case "--version":
      case "-v":
        options.version = true
        break

      case "--inspect":
      case "-i":
        options.command = "inspect"
        options.databasePath = args[++i]
        break

      case "--init":
        options.command = "init"
        options.databasePath = args[++i]
        break

      case "--template":
      case "-t":
        options.template = args[++i]
        break

      case "--validate":
        options.command = "validate"
        options.databasePath = args[++i]
        break

      case "--test":
        options.command = "test"
        break

      case "--readonly":
      case "--read-only":
        options.readonly = true
        break

      case "--timeout":
        if (i + 1 < args.length && args[i + 1]) {
          options.timeout = parseInt(args[++i]!, 10)
        }
        break

      case "--max-results":
        if (i + 1 < args.length && args[i + 1]) {
          options.maxResults = parseInt(args[++i]!, 10)
        }
        break

      default:
        if (arg && !arg.startsWith("-") && !options.databasePath && !options.command) {
          options.databasePath = arg
        }
    }
  }

  return options
}

export function showHelp(): void {
  console.log(`
kuzudb-mcp-server v${version}

A Model Context Protocol server for Kuzu graph databases.

USAGE:
  npx kuzudb-mcp-server [OPTIONS] [DATABASE_PATH]

OPTIONS:
  --help, -h              Show this help message
  --version, -v           Show version information
  --inspect, -i <path>    Inspect database schema and statistics
  --init <path>           Initialize a new database
  --template, -t <name>   Use a template (movies, social, financial)
  --validate <path>       Validate database health
  --test                  Run built-in test suite
  --readonly              Start in read-only mode
  --timeout <ms>          Query timeout in milliseconds
  --max-results <n>       Maximum result set size

EXAMPLES:
  # Start MCP server
  npx kuzudb-mcp-server ./my-database

  # Inspect database
  npx kuzudb-mcp-server --inspect ./my-database

  # Initialize with template
  npx kuzudb-mcp-server --init ./new-db --template movies

  # Validate database
  npx kuzudb-mcp-server --validate ./my-database

  # Read-only mode with options
  npx kuzudb-mcp-server ./prod-db --readonly --timeout 30000
`)
}

export function showVersion(): void {
  console.log(`kuzudb-mcp-server v${version}`)
}

export async function inspectDatabase(dbPath: string): Promise<void> {
  console.log(`\nInspecting database: ${dbPath}\n`)

  try {
    const db = new Database(dbPath, 0, false, true)
    const conn = new Connection(db)

    // Get all node tables
    const nodeResult = await conn.query("CALL show_tables() RETURN *")
    const allTables = await nodeResult.getAll()
    interface TableRecord {
      name: string
      type: string
      comment?: string
    }
    const nodeTables = allTables.filter(
      (t) => (t as unknown as TableRecord).type === "NODE",
    ) as unknown as TableRecord[]

    console.log("NODE TABLES:")
    console.log("============")
    for (const table of nodeTables) {
      console.log(`\n${table.name}:`)
      const schemaResult = await conn.query(`CALL table_info('${table.name}') RETURN *`)
      const schema = await schemaResult.getAll()
      for (const prop of schema) {
        const propData = prop as { name: string; type: string }
        console.log(`  - ${propData.name}: ${propData.type}`)
      }

      // Get count
      const countResult = await conn.query(`MATCH (n:${table.name}) RETURN count(n) as count`)
      const count = await countResult.getAll()
      const countData = count[0] as { count: number }
      console.log(`  Count: ${countData.count}`)
    }

    // Get all relationship tables
    const relTables = allTables.filter((t) => (t as unknown as TableRecord).type === "REL") as unknown as TableRecord[]

    console.log("\n\nRELATIONSHIP TABLES:")
    console.log("====================")
    for (const table of relTables) {
      console.log(`\n${table.name}:`)
      const schemaResult = await conn.query(`CALL table_info('${table.name}') RETURN *`)
      const schema = await schemaResult.getAll()
      for (const prop of schema) {
        const propData = prop as { name: string; type: string }
        console.log(`  - ${propData.name}: ${propData.type}`)
      }

      // Get count
      const countResult = await conn.query(`MATCH ()-[r:${table.name}]->() RETURN count(r) as count`)
      const count = await countResult.getAll()
      const countData = count[0] as { count: number }
      console.log(`  Count: ${countData.count}`)
    }

    // Close connection and database if needed
    // Note: kuzu Node.js bindings may not require explicit closing
  } catch (error) {
    console.error("Error inspecting database:", error)
    process.exit(1)
  }
}

export async function validateDatabase(dbPath: string): Promise<void> {
  console.log(`\nValidating database: ${dbPath}\n`)

  const checks = {
    exists: false,
    readable: false,
    connectable: false,
    queryable: false,
    hasSchema: false,
  }

  try {
    // Check if path exists
    await fs.access(dbPath)
    checks.exists = true
    console.log("✓ Database path exists")

    // Check if readable
    await fs.access(dbPath, fs.constants.R_OK)
    checks.readable = true
    console.log("✓ Database is readable")

    // Try to connect
    const db = new Database(dbPath, 0, false, true)
    checks.connectable = true
    console.log("✓ Database connection successful")

    const conn = new Connection(db)

    // Try a simple query
    const result = await conn.query("RETURN 1 as test")
    const data = await result.getAll()
    const testData = data[0] as { test: number }
    if (testData.test === 1) {
      checks.queryable = true
      console.log("✓ Basic query execution works")
    }

    // Check for schema
    const nodeResult = await conn.query("CALL show_tables() RETURN *")
    const nodes = await nodeResult.getAll()
    if (nodes.length > 0) {
      checks.hasSchema = true
      console.log("✓ Database has schema defined")
    } else {
      console.log("⚠ Database has no schema defined")
    }

    // Close connection and database if needed
    // Note: kuzu Node.js bindings may not require explicit closing

    const allPassed = Object.values(checks).every((v) => v)
    console.log(`\nValidation ${allPassed ? "PASSED" : "FAILED"}`)
  } catch (error) {
    console.error("✗ Validation failed:", error)
    console.log("\nValidation FAILED")
    process.exit(1)
  }
}

export async function initDatabase(dbPath: string, template?: string): Promise<void> {
  console.log(`\nInitializing new database: ${dbPath}`)
  if (template) {
    console.log(`Using template: ${template}\n`)
  }

  try {
    // Create directory if it doesn't exist
    await fs.mkdir(path.dirname(dbPath), { recursive: true })

    const db = new Database(dbPath)
    const conn = new Connection(db)

    switch (template) {
      case "movies":
        await initMoviesTemplate(conn)
        break
      case "social":
        await initSocialTemplate(conn)
        break
      case "financial":
        await initFinancialTemplate(conn)
        break
      default:
        console.log("Created empty database. Use --template to initialize with sample data.")
    }

    // Close connection and database if needed
    // Note: kuzu Node.js bindings may not require explicit closing

    console.log("\n✓ Database initialized successfully!")
  } catch (error) {
    console.error("Error initializing database:", error)
    process.exit(1)
  }
}

async function initMoviesTemplate(conn: Connection): Promise<void> {
  console.log("Creating movies schema...")

  // Create node tables
  await conn.query(`CREATE NODE TABLE Person(name STRING, born INT64, PRIMARY KEY(name))`)
  await conn.query(`CREATE NODE TABLE Movie(title STRING, released INT64, tagline STRING, PRIMARY KEY(title))`)

  // Create relationship tables
  await conn.query(`CREATE REL TABLE ACTED_IN(FROM Person TO Movie, roles STRING[])`)
  await conn.query(`CREATE REL TABLE DIRECTED(FROM Person TO Movie)`)

  console.log("Adding sample data...")

  // Add some sample movies and actors
  await conn.query(`
    CREATE (tom:Person {name: 'Tom Hanks', born: 1956}),
           (forrest:Movie {title: 'Forrest Gump', released: 1994, tagline: 'Life is like a box of chocolates'}),
           (castaway:Movie {title: 'Cast Away', released: 2000, tagline: 'At the edge of the world, his journey begins'}),
           (robert:Person {name: 'Robert Zemeckis', born: 1951})
  `)

  await conn.query(`
    MATCH (tom:Person {name: 'Tom Hanks'}), (forrest:Movie {title: 'Forrest Gump'})
    CREATE (tom)-[:ACTED_IN {roles: ['Forrest Gump']}]->(forrest)
  `)

  await conn.query(`
    MATCH (tom:Person {name: 'Tom Hanks'}), (castaway:Movie {title: 'Cast Away'})
    CREATE (tom)-[:ACTED_IN {roles: ['Chuck Noland']}]->(castaway)
  `)

  await conn.query(`
    MATCH (robert:Person {name: 'Robert Zemeckis'}), (forrest:Movie {title: 'Forrest Gump'})
    CREATE (robert)-[:DIRECTED]->(forrest)
  `)

  await conn.query(`
    MATCH (robert:Person {name: 'Robert Zemeckis'}), (castaway:Movie {title: 'Cast Away'})
    CREATE (robert)-[:DIRECTED]->(castaway)
  `)

  console.log("✓ Movies template initialized")
}

async function initSocialTemplate(conn: Connection): Promise<void> {
  console.log("Creating social network schema...")

  await conn.query(`CREATE NODE TABLE User(id INT64, name STRING, email STRING, joined DATE, PRIMARY KEY(id))`)
  await conn.query(`CREATE NODE TABLE Post(id INT64, content STRING, created TIMESTAMP, PRIMARY KEY(id))`)
  await conn.query(`CREATE REL TABLE FOLLOWS(FROM User TO User, since DATE)`)
  await conn.query(`CREATE REL TABLE POSTED(FROM User TO Post)`)
  await conn.query(`CREATE REL TABLE LIKES(FROM User TO Post, timestamp TIMESTAMP)`)

  console.log("✓ Social network template initialized")
}

async function initFinancialTemplate(conn: Connection): Promise<void> {
  console.log("Creating financial schema...")

  await conn.query(`CREATE NODE TABLE Account(id STRING, balance DOUBLE, type STRING, PRIMARY KEY(id))`)
  await conn.query(`CREATE NODE TABLE Customer(id INT64, name STRING, email STRING, PRIMARY KEY(id))`)
  await conn.query(`CREATE REL TABLE OWNS(FROM Customer TO Account)`)
  await conn.query(`CREATE REL TABLE TRANSFER(FROM Account TO Account, amount DOUBLE, date DATE, description STRING)`)

  console.log("✓ Financial template initialized")
}

export async function runTests(): Promise<void> {
  console.log("\nRunning test suite...\n")

  try {
    // Create temporary test database
    const testDb = "./test-db-" + Date.now()
    console.log("Creating test database...")

    const db = new Database(testDb)
    const conn = new Connection(db)

    // Test 1: Create schema
    console.log("Test 1: Creating schema... ")
    await conn.query("CREATE NODE TABLE TestNode(id INT64, name STRING, PRIMARY KEY(id))")
    console.log("✓ PASSED")

    // Test 2: Insert data
    console.log("Test 2: Inserting data... ")
    await conn.query("CREATE (n:TestNode {id: 1, name: 'test'})")
    console.log("✓ PASSED")

    // Test 3: Query data
    console.log("Test 3: Querying data... ")
    const result = await conn.query("MATCH (n:TestNode) RETURN n.name as name")
    const data = await result.getAll()
    const testResult = data[0] as { name: string }
    if (testResult.name === "test") {
      console.log("✓ PASSED")
    } else {
      throw new Error("Query returned unexpected result")
    }

    // Cleanup
    // Close connection and database if needed
    // Note: kuzu Node.js bindings may not require explicit closing
    await fs.rm(testDb, { recursive: true, force: true })

    console.log("\nAll tests passed! ✓")
  } catch (error) {
    console.error("✗ FAILED:", error)
    process.exit(1)
  }
}
