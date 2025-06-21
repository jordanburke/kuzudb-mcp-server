import { describe, it, expect } from "vitest"
import { detectCompositePrimaryKey, formatKuzuError } from "../query-helpers"

describe("Composite Primary Key Detection", () => {
  describe("detectCompositePrimaryKey", () => {
    it("should detect composite primary keys with two columns", () => {
      const queries = [
        "CREATE NODE TABLE Test(id1 INT64, id2 INT64, PRIMARY KEY(id1, id2))",
        "CREATE NODE TABLE Test(col1 STRING, col2 STRING, PRIMARY KEY(col1, col2))",
        "CREATE NODE TABLE Test(a INT64, b INT64, c STRING, PRIMARY KEY(a, b))",
        "CREATE NODE TABLE Test(id1 INT64, id2 INT64, PRIMARY KEY  (id1, id2))", // extra spaces
        "CREATE NODE TABLE Test(id1 INT64, id2 INT64, primary key(id1, id2))", // lowercase
      ]

      queries.forEach((query) => {
        expect(detectCompositePrimaryKey(query)).toBe(true)
      })
    })

    it("should detect composite primary keys with multiple columns", () => {
      const queries = [
        "CREATE NODE TABLE Test(a INT64, b INT64, c INT64, PRIMARY KEY(a, b, c))",
        "CREATE NODE TABLE Test(x STRING, y STRING, z STRING, w INT64, PRIMARY KEY(x, y, z))",
      ]

      queries.forEach((query) => {
        expect(detectCompositePrimaryKey(query)).toBe(true)
      })
    })

    it("should not detect single-column primary keys", () => {
      const queries = [
        "CREATE NODE TABLE Test(id INT64, PRIMARY KEY(id))",
        "CREATE NODE TABLE Test(id SERIAL, PRIMARY KEY(id))",
        "CREATE NODE TABLE Test(name STRING, age INT64, PRIMARY KEY(name))",
        "CREATE NODE TABLE Test(id INT64, name STRING, PRIMARY KEY  (id))", // extra spaces
      ]

      queries.forEach((query) => {
        expect(detectCompositePrimaryKey(query)).toBe(false)
      })
    })

    it("should not detect when PRIMARY KEY is not present", () => {
      const queries = [
        "CREATE NODE TABLE Test(id INT64, name STRING)",
        "CREATE (n:Node {id: 1, name: 'test'})",
        "MATCH (n:Node) RETURN n",
      ]

      queries.forEach((query) => {
        expect(detectCompositePrimaryKey(query)).toBe(false)
      })
    })
  })

  describe("formatKuzuError with composite key detection", () => {
    it("should format composite key parser errors with helpful message", () => {
      const error = new Error("Parser exception: extraneous input ',' expecting {')', SP} (line: 1, offset: 69)")
      const query = "CREATE NODE TABLE Test(id1 INT64, id2 INT64, PRIMARY KEY(id1, id2))"

      const result = formatKuzuError(error, query)

      expect(result).toEqual({
        error: "UNSUPPORTED_FEATURE",
        message: "Kuzu does not support composite primary keys. Please use a single-column primary key.",
        type: "unsupported_feature",
        suggestion: "Consider concatenating columns or using a SERIAL primary key with a unique constraint.",
        documentation: "https://kuzudb.com/docs/cypher/data-definition/create-table",
        line: 1,
        offset: 69,
        originalError: expect.stringContaining("Parser exception") as string,
      })
    })

    it("should format regular parser errors without composite key message", () => {
      const error = new Error("Parser exception: Invalid syntax (line: 1, offset: 10)")
      const query = "CREATE INVALID SYNTAX"

      const result = formatKuzuError(error, query)

      expect(result).toEqual({
        error: "PARSER_ERROR",
        message: "Invalid syntax",
        type: "syntax_error",
        line: 1,
        offset: 10,
        originalError: expect.stringContaining("Parser exception") as string,
      })
    })

    it("should include query snippet in error context", () => {
      const error = new Error("Some random error")
      const longQuery = "CREATE " + "x".repeat(300)

      const result = formatKuzuError(error, longQuery)

      expect(result.query).toBeDefined()
      expect((result.query as string).length).toBeLessThanOrEqual(203) // 200 + "..."
      expect(result.query).toContain("...")
    })
  })
})
