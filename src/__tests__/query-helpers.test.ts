import { describe, it, expect, vi, beforeEach } from "vitest"
import { processQueryResults, executeBatchQuery, formatKuzuError } from "../query-helpers"
import type * as kuzu from "kuzu"

// Mock kuzu types and functions
const mockQueryResult = {
  getAll: vi.fn(),
  close: vi.fn(),
} as unknown as kuzu.QueryResult

const mockConnection = {
  query: vi.fn(),
} as unknown as kuzu.Connection

describe("Query Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("processQueryResults", () => {
    it("should process a single query result", async () => {
      const mockRows = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]
      mockQueryResult.getAll = vi.fn().mockResolvedValue(mockRows)
      mockQueryResult.close = vi.fn()

      const result = await processQueryResults(mockQueryResult)

      expect(result).toEqual(mockRows)
      expect(mockQueryResult.getAll).toHaveBeenCalledOnce()
      expect(mockQueryResult.close).toHaveBeenCalledOnce()
    })

    it("should process an array of query results", async () => {
      const mockResult1 = {
        getAll: vi.fn().mockResolvedValue([{ id: 1, name: "Alice" }]),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      const mockResult2 = {
        getAll: vi.fn().mockResolvedValue([{ id: 2, name: "Bob" }]),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      const mockResult3 = {
        getAll: vi.fn().mockResolvedValue([{ id: 3, name: "Charlie" }]),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      const result = await processQueryResults([mockResult1, mockResult2, mockResult3])

      expect(result).toEqual([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" },
      ])
      expect(mockResult1.getAll).toHaveBeenCalledOnce()
      expect(mockResult2.getAll).toHaveBeenCalledOnce()
      expect(mockResult3.getAll).toHaveBeenCalledOnce()
      expect(mockResult1.close).toHaveBeenCalledOnce()
      expect(mockResult2.close).toHaveBeenCalledOnce()
      expect(mockResult3.close).toHaveBeenCalledOnce()
    })

    it("should handle errors in single query result", async () => {
      const error = new Error("Query failed")
      mockQueryResult.getAll = vi.fn().mockRejectedValue(error)
      mockQueryResult.close = vi.fn()

      await expect(processQueryResults(mockQueryResult)).rejects.toThrow("Query failed")
      expect(mockQueryResult.close).toHaveBeenCalledOnce()
    })

    it("should continue processing array results even if one fails", async () => {
      const mockResult1 = {
        getAll: vi.fn().mockResolvedValue([{ id: 1, name: "Alice" }]),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      const mockResult2 = {
        getAll: vi.fn().mockRejectedValue(new Error("Query 2 failed")),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      const mockResult3 = {
        getAll: vi.fn().mockResolvedValue([{ id: 3, name: "Charlie" }]),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      const result = await processQueryResults([mockResult1, mockResult2, mockResult3])

      expect(result).toEqual([
        { id: 1, name: "Alice" },
        { id: 3, name: "Charlie" },
      ])
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error processing individual query result:", expect.any(Error))
      expect(mockResult2.close).toHaveBeenCalledOnce()

      consoleErrorSpy.mockRestore()
    })
  })

  describe("executeBatchQuery", () => {
    it("should execute a batch query successfully", async () => {
      const mockRows = [{ result: "Success" }]
      const mockResult = {
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      mockConnection.query = vi.fn().mockResolvedValue(mockResult)

      const result = await executeBatchQuery(
        mockConnection,
        "CREATE (p:Person {name: 'Alice'}); CREATE (p:Person {name: 'Bob'})",
      )

      expect(result).toEqual(mockRows)
      expect(mockConnection.query).toHaveBeenCalledOnce()
      expect(mockConnection.query).toHaveBeenCalledWith(
        "CREATE (p:Person {name: 'Alice'}); CREATE (p:Person {name: 'Bob'})",
      )
    })

    it("should handle batch query returning multiple results", async () => {
      const mockResult1 = {
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      const mockResult2 = {
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      mockConnection.query = vi.fn().mockResolvedValue([mockResult1, mockResult2])

      const result = await executeBatchQuery(
        mockConnection,
        "CREATE (p:Person {name: 'Alice'}); CREATE (p:Person {name: 'Bob'})",
      )

      // When Kuzu returns an array of results (batch execution), we now add statement info
      expect(result).toEqual([
        {
          statement: 1,
          query: "CREATE (p:Person {name: 'Alice'})",
          result: "Success",
          rowsAffected: 0,
        },
        {
          statement: 2,
          query: "CREATE (p:Person {name: 'Bob'})",
          result: "Success",
          rowsAffected: 0,
        },
      ])
      expect(mockConnection.query).toHaveBeenCalledOnce()
    })

    it("should fall back to individual statements on batch failure", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      // First call fails (batch)
      mockConnection.query = vi
        .fn()
        .mockRejectedValueOnce(new Error("Batch execution failed"))
        // Individual calls succeed
        .mockResolvedValueOnce({
          getAll: vi.fn().mockResolvedValue([]),
          close: vi.fn(),
        })
        .mockResolvedValueOnce({
          getAll: vi.fn().mockResolvedValue([]),
          close: vi.fn(),
        })

      const result = await executeBatchQuery(
        mockConnection,
        "CREATE (p:Person {name: 'Alice'}); CREATE (p:Person {name: 'Bob'})",
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        statement: 1,
        query: "CREATE (p:Person {name: 'Alice'})",
        result: "Success",
        rowsAffected: 0,
      })
      expect(result[1]).toMatchObject({
        statement: 2,
        query: "CREATE (p:Person {name: 'Bob'})",
        result: "Success",
        rowsAffected: 0,
      })
      expect(mockConnection.query).toHaveBeenCalledTimes(3)

      consoleErrorSpy.mockRestore()
    })

    it("should handle mixed success and failure in fallback mode", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      mockConnection.query = vi
        .fn()
        .mockRejectedValueOnce(new Error("Batch execution failed"))
        .mockResolvedValueOnce({
          getAll: vi.fn().mockResolvedValue([]),
          close: vi.fn(),
        })
        .mockRejectedValueOnce(new Error("Duplicate key"))
        .mockResolvedValueOnce({
          getAll: vi.fn().mockResolvedValue([]),
          close: vi.fn(),
        })

      const result = await executeBatchQuery(
        mockConnection,
        "CREATE (p:Person {id: 1}); CREATE (p:Person {id: 1}); CREATE (p:Person {id: 2})",
      )

      expect(result).toHaveLength(3)
      expect(result[0]).toMatchObject({
        statement: 1,
        result: "Success",
      })
      expect(result[1]).toMatchObject({
        statement: 2,
        error: "Duplicate key",
      })
      expect(result[2]).toMatchObject({
        statement: 3,
        result: "Success",
      })

      consoleErrorSpy.mockRestore()
    })

    it("should throw error if all individual statements fail", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      mockConnection.query = vi
        .fn()
        .mockRejectedValueOnce(new Error("Batch execution failed"))
        .mockRejectedValueOnce(new Error("Statement 1 failed"))
        .mockRejectedValueOnce(new Error("Statement 2 failed"))

      await expect(
        executeBatchQuery(mockConnection, "CREATE (p:Person {id: 1}); CREATE (p:Person {id: 2})"),
      ).rejects.toThrow("All statements failed:\nStatement 1: Statement 1 failed\nStatement 2: Statement 2 failed")

      consoleErrorSpy.mockRestore()
    })

    it("should handle single statement queries", async () => {
      const mockResult = {
        getAll: vi.fn().mockResolvedValue([{ id: 1, name: "Alice" }]),
        close: vi.fn(),
      } as unknown as kuzu.QueryResult

      mockConnection.query = vi.fn().mockResolvedValue(mockResult)

      const result = await executeBatchQuery(mockConnection, "MATCH (p:Person) RETURN p")

      expect(result).toEqual([{ id: 1, name: "Alice" }])
      expect(mockConnection.query).toHaveBeenCalledOnce()
    })

    it("should re-throw error for single statement that fails", async () => {
      const error = new Error("Query failed")
      mockConnection.query = vi.fn().mockRejectedValue(error)

      await expect(executeBatchQuery(mockConnection, "INVALID QUERY")).rejects.toThrow("Query failed")
    })
  })

  describe("formatKuzuError", () => {
    it("should format primary key violation errors", () => {
      const error = new Error(
        "Runtime exception: Found duplicated primary key value TestValue, which violates the uniqueness constraint of the primary key column.",
      )

      const result = formatKuzuError(error)

      expect(result).toEqual({
        error: "PRIMARY_KEY_VIOLATION",
        message: expect.stringContaining("duplicated primary key") as string,
        type: "constraint_violation",
        value: "TestValue",
        originalError: expect.stringContaining("duplicated primary key") as string,
      })
    })

    it("should format parser errors with position", () => {
      const error = new Error("Parser exception: extraneous input ',' expecting {')', SP} (line: 1, offset: 74)")

      const result = formatKuzuError(error)

      expect(result).toEqual({
        error: "PARSER_ERROR",
        message: "extraneous input ',' expecting {')', SP}",
        type: "syntax_error",
        line: 1,
        offset: 74,
        originalError: expect.stringContaining("Parser exception") as string,
      })
    })

    it("should format runtime errors", () => {
      const error = new Error("Runtime exception: Table Person does not exist.")

      const result = formatKuzuError(error)

      expect(result).toEqual({
        error: "RUNTIME_ERROR",
        message: "Table Person does not exist.",
        type: "runtime_error",
        originalError: expect.stringContaining("Runtime exception") as string,
      })
    })

    it("should handle generic errors", () => {
      const error = new Error("Some unexpected error")

      const result = formatKuzuError(error)

      expect(result).toEqual({
        error: "QUERY_ERROR",
        message: "Some unexpected error",
        type: "unknown",
        originalError: "Some unexpected error",
      })
    })

    it("should handle non-Error objects", () => {
      const result = formatKuzuError("String error")

      expect(result).toEqual({
        error: "UNKNOWN_ERROR",
        message: "String error",
        type: "unknown",
      })
    })

    it("should handle null/undefined errors", () => {
      expect(formatKuzuError(null)).toEqual({
        error: "UNKNOWN_ERROR",
        message: "null",
        type: "unknown",
      })

      expect(formatKuzuError(undefined)).toEqual({
        error: "UNKNOWN_ERROR",
        message: "undefined",
        type: "unknown",
      })
    })

    it("should handle primary key errors without value match", () => {
      const error = new Error("Runtime exception: Found duplicated primary key value")

      const result = formatKuzuError(error)

      expect(result).toEqual({
        error: "PRIMARY_KEY_VIOLATION",
        message: expect.stringContaining("duplicated primary key") as string,
        type: "constraint_violation",
        value: undefined,
        originalError: expect.stringContaining("duplicated primary key") as string,
      })
    })
  })
})
