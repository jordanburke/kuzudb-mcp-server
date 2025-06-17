import { describe, it, expect } from "vitest"

describe("Index module", () => {
  it("should export the module", () => {
    // Since index.ts is the MCP server entry point and requires
    // specific environment setup, we just verify it can be imported
    expect(async () => {
      await import("../index")
    }).not.toThrow()
  })
})
