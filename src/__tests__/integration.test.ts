import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn } from "child_process"
import * as fs from "fs/promises"

describe.skip("Integration Tests", () => {
  const testDbPath = "./test-integration-db-" + Date.now()

  beforeAll(async () => {
    // Initialize a test database
    const init = spawn("node", ["dist/index.js", "--init", testDbPath, "--template", "movies"], {
      stdio: "pipe",
    })

    await new Promise((resolve, reject) => {
      init.on("close", (code) => {
        if (code === 0) resolve(undefined)
        else reject(new Error(`Init failed with code ${code}`))
      })
    })
  })

  afterAll(async () => {
    try {
      await fs.rm(testDbPath, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it("should initialize database with template", async () => {
    const files = await fs.readdir(testDbPath)
    expect(files).toContain("catalog.kz")
    expect(files).toContain("data.kz")
  })

  it("should validate database successfully", async () => {
    const validate = spawn("node", ["dist/index.js", "--validate", testDbPath], {
      stdio: "pipe",
    })

    let output = ""
    validate.stdout.on("data", (data: Buffer) => {
      output += data.toString()
    })

    await new Promise((resolve) => {
      validate.on("close", () => resolve(undefined))
    })

    expect(output).toContain("Database path exists")
    expect(output).toContain("Database is readable")
    expect(output).toContain("Database connection successful")
    expect(output).toContain("Basic query execution works")
    expect(output).toContain("Database has schema defined")
    expect(output).toContain("Validation PASSED")
  })

  it("should inspect database and show schema", async () => {
    const inspect = spawn("node", ["dist/index.js", "--inspect", testDbPath], {
      stdio: "pipe",
    })

    let output = ""
    inspect.stdout.on("data", (data: Buffer) => {
      output += data.toString()
    })

    await new Promise((resolve) => {
      inspect.on("close", () => resolve(undefined))
    })

    expect(output).toContain("NODE TABLES:")
    expect(output).toContain("Movie:")
    expect(output).toContain("Person:")
    expect(output).toContain("RELATIONSHIP TABLES:")
    expect(output).toContain("ACTED_IN:")
    expect(output).toContain("DIRECTED:")
  })

  it("should show help text", async () => {
    const help = spawn("node", ["dist/index.js", "--help"], {
      stdio: "pipe",
    })

    let output = ""
    help.stdout.on("data", (data: Buffer) => {
      output += data.toString()
    })

    await new Promise((resolve) => {
      help.on("close", () => resolve(undefined))
    })

    expect(output).toContain("kuzudb-mcp-server")
    expect(output).toContain("USAGE:")
    expect(output).toContain("OPTIONS:")
    expect(output).toContain("EXAMPLES:")
  })

  it("should show version", async () => {
    const version = spawn("node", ["dist/index.js", "--version"], {
      stdio: "pipe",
    })

    let output = ""
    version.stdout.on("data", (data: Buffer) => {
      output += data.toString()
    })

    await new Promise((resolve) => {
      version.on("close", () => resolve(undefined))
    })

    expect(output).toMatch(/kuzudb-mcp-server v\d+\.\d+\.\d+/)
  })
})
