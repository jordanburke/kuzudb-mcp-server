import { vi } from "vitest"

// Mock process.exit to prevent tests from actually exiting
vi.spyOn(process, "exit").mockImplementation((code?: string | number | null): never => {
  throw new Error(`process.exit called with code ${code}`)
})
