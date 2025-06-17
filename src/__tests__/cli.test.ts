import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import { parseArgs, showHelp, showVersion, validateDatabase, initDatabase, runTests } from "../cli"

describe("CLI Functions", () => {
  describe("parseArgs", () => {
    it("should parse help flags", () => {
      expect(parseArgs(["--help"])).toEqual({ help: true })
      expect(parseArgs(["-h"])).toEqual({ help: true })
    })

    it("should parse version flags", () => {
      expect(parseArgs(["--version"])).toEqual({ version: true })
      expect(parseArgs(["-v"])).toEqual({ version: true })
    })

    it("should parse inspect command", () => {
      expect(parseArgs(["--inspect", "./db"])).toEqual({
        command: "inspect",
        databasePath: "./db",
      })
      expect(parseArgs(["-i", "./db"])).toEqual({
        command: "inspect",
        databasePath: "./db",
      })
    })

    it("should parse init command with template", () => {
      expect(parseArgs(["--init", "./newdb", "--template", "movies"])).toEqual({
        command: "init",
        databasePath: "./newdb",
        template: "movies",
      })
    })

    it("should parse validate command", () => {
      expect(parseArgs(["--validate", "./db"])).toEqual({
        command: "validate",
        databasePath: "./db",
      })
    })

    it("should parse test command", () => {
      expect(parseArgs(["--test"])).toEqual({
        command: "test",
      })
    })

    it("should parse readonly flag", () => {
      expect(parseArgs(["./db", "--readonly"])).toEqual({
        databasePath: "./db",
        readonly: true,
      })
      expect(parseArgs(["./db", "--read-only"])).toEqual({
        databasePath: "./db",
        readonly: true,
      })
    })

    it("should parse timeout option", () => {
      expect(parseArgs(["./db", "--timeout", "5000"])).toEqual({
        databasePath: "./db",
        timeout: 5000,
      })
    })

    it("should parse max-results option", () => {
      expect(parseArgs(["./db", "--max-results", "100"])).toEqual({
        databasePath: "./db",
        maxResults: 100,
      })
    })

    it("should parse database path as default argument", () => {
      expect(parseArgs(["./mydb"])).toEqual({
        databasePath: "./mydb",
      })
    })

    it("should handle complex argument combinations", () => {
      expect(parseArgs(["--init", "./newdb", "--template", "movies", "--readonly", "--timeout", "3000"])).toEqual({
        command: "init",
        databasePath: "./newdb",
        template: "movies",
        readonly: true,
        timeout: 3000,
      })
    })
  })

  describe("Database operations", () => {
    let testDbPath: string

    beforeEach(() => {
      // Create unique path for each test
      testDbPath = "./test-db-" + Date.now() + "-" + Math.random().toString(36).substring(7)
    })

    afterEach(async () => {
      // Cleanup test database
      if (testDbPath) {
        try {
          // Add delay to ensure all async operations complete
          await new Promise((resolve) => setTimeout(resolve, 100))
          await fs.rm(testDbPath, { recursive: true, force: true })
        } catch (error) {
          console.warn(`Failed to cleanup ${testDbPath}:`, error)
        }
      }
    })

    describe("initDatabase", () => {
      it.skip("should create an empty database", async () => {
        await initDatabase(testDbPath)

        // Check that database files exist
        // Small delay to ensure files are written
        await new Promise((resolve) => setTimeout(resolve, 100))

        const files = await fs.readdir(testDbPath)
        expect(files.length).toBeGreaterThan(0)
        expect(files).toContain("catalog.kz")
      })

      it("should create database with movies template", async () => {
        await initDatabase(testDbPath, "movies")
        // Wait for files to be created
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Check that database files exist
        const files = await fs.readdir(testDbPath)
        expect(files).toContain("catalog.kz")
        expect(files).toContain("data.kz")
      })

      it("should create database with social template", async () => {
        await initDatabase(testDbPath, "social")
        // Wait for files to be created
        await new Promise((resolve) => setTimeout(resolve, 100))

        const files = await fs.readdir(testDbPath)
        expect(files).toContain("catalog.kz")
      })

      it("should create database with financial template", async () => {
        await initDatabase(testDbPath, "financial")
        // Wait for files to be created
        await new Promise((resolve) => setTimeout(resolve, 100))

        const files = await fs.readdir(testDbPath)
        expect(files).toContain("catalog.kz")
      })
    })

    describe("validateDatabase", () => {
      it("should validate a properly initialized database", async () => {
        // First create a database
        await initDatabase(testDbPath, "movies")
        // Wait for files to be created
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Mock console.log to capture output
        const logs: string[] = []
        const originalLog = console.log
        console.log = (msg: string) => logs.push(msg)

        try {
          await validateDatabase(testDbPath)

          expect(logs).toContain("✓ Database path exists")
          expect(logs).toContain("✓ Database is readable")
          expect(logs).toContain("✓ Database connection successful")
          expect(logs).toContain("✓ Basic query execution works")
          expect(logs).toContain("✓ Database has schema defined")
          expect(logs.some((log) => log.includes("Validation PASSED"))).toBe(true)
        } finally {
          console.log = originalLog
        }
      })

      it("should fail validation for non-existent database", async () => {
        const logs: string[] = []
        const errors: string[] = []
        const originalLog = console.log.bind(console)
        const originalError = console.error.bind(console)
        const originalExit = process.exit.bind(process)

        console.log = (msg: string) => logs.push(msg)
        console.error = (msg: string, ..._args: unknown[]) => errors.push(msg)
        process.exit = (() => {
          throw new Error("Process exit called")
        }) as unknown as typeof process.exit

        try {
          await validateDatabase("./non-existent-db")
        } catch {
          expect(errors.some((e) => e.includes("Validation failed"))).toBe(true)
        } finally {
          console.log = originalLog
          console.error = originalError
          process.exit = originalExit
        }
      })
    })

    describe("runTests", () => {
      it("should run the built-in test suite successfully", async () => {
        const logs: string[] = []
        const originalLog = console.log
        let testDbPath: string | undefined

        console.log = (msg: string) => {
          logs.push(msg)
          // Capture the test database path
          if (msg.includes("Creating test database")) {
            // The runTests function creates a db with pattern ./test-db-{timestamp}
            // We need to capture it from the logs
            const nextLogIndex = logs.length
            setTimeout(() => {
              if (logs[nextLogIndex] && logs[nextLogIndex].includes("Creating database at:")) {
                const match = logs[nextLogIndex].match(/Creating database at: (.+test-db-\d+)/)
                if (match && match[1]) {
                  testDbPath = match[1].replace(process.cwd() + "/", "./")
                }
              }
            }, 0)
          }
        }

        try {
          await runTests()

          expect(logs).toContain("✓ PASSED")
          expect(logs.some((log) => log.includes("Test 1: Creating schema"))).toBe(true)
          expect(logs.some((log) => log.includes("Test 2: Inserting data"))).toBe(true)
          expect(logs.some((log) => log.includes("Test 3: Querying data"))).toBe(true)
          expect(logs.some((log) => log.includes("All tests passed!"))).toBe(true)
        } finally {
          console.log = originalLog

          // Clean up the test database created by runTests
          if (testDbPath || logs.some((log) => log.includes("test-db-"))) {
            // Try to find the database path from logs
            if (!testDbPath) {
              for (const log of logs) {
                const match = log.match(/test-db-\d+/)
                if (match) {
                  testDbPath = "./" + match[0]
                  break
                }
              }
            }

            if (testDbPath) {
              try {
                await new Promise((resolve) => setTimeout(resolve, 200))
                await fs.rm(testDbPath, { recursive: true, force: true })
              } catch (error) {
                console.warn(`Failed to cleanup runTests database ${testDbPath}:`, error)
              }
            }
          }
        }
      })
    })
  })

  describe("Output functions", () => {
    it("showHelp should output help text", () => {
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)

      try {
        showHelp()
        const output = logs.join("\n")

        expect(output).toContain("kuzudb-mcp-server")
        expect(output).toContain("--help")
        expect(output).toContain("--version")
        expect(output).toContain("--inspect")
        expect(output).toContain("--init")
        expect(output).toContain("--template")
        expect(output).toContain("--validate")
        expect(output).toContain("--test")
        expect(output).toContain("EXAMPLES:")
      } finally {
        console.log = originalLog
      }
    })

    it("showVersion should output version", () => {
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)

      try {
        showVersion()
        expect(logs[0]).toMatch(/^kuzudb-mcp-server v\d+\.\d+\.\d+$/)
      } finally {
        console.log = originalLog
      }
    })
  })
})
