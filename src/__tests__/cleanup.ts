import { afterAll } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"

// Global cleanup to remove any test databases that might have been left behind
afterAll(async () => {
  try {
    const cwd = process.cwd()
    const entries = await fs.readdir(cwd, { withFileTypes: true })

    // Find all test database directories
    const testDbs = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("test-db-"))
      .map((entry) => path.join(cwd, entry.name))

    // Remove them
    for (const testDb of testDbs) {
      try {
        await fs.rm(testDb, { recursive: true, force: true })
        console.log(`Cleaned up ${testDb}`)
      } catch (error) {
        console.warn(`Failed to cleanup ${testDb}:`, error)
      }
    }
  } catch (error) {
    console.warn("Global cleanup failed:", error)
  }
})
