import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as kuzu from "kuzu"
import * as fs from "fs/promises"

// Test the core logic without mocking the entire server
describe("Server Logic Tests", () => {
  const testDbPath = "./test-logic-db-" + Date.now()
  let db: kuzu.Database
  let conn: kuzu.Connection

  beforeAll(async () => {
    // Create a test database
    db = new kuzu.Database(testDbPath)
    conn = new kuzu.Connection(db)

    // Create test schema
    await conn.query("CREATE NODE TABLE Person(name STRING, age INT64, PRIMARY KEY(name))")
    await conn.query("CREATE NODE TABLE Movie(title STRING, year INT64, PRIMARY KEY(title))")
    await conn.query("CREATE REL TABLE DIRECTED(FROM Person TO Movie)")

    // Insert test data
    await conn.query("CREATE (p:Person {name: 'Christopher Nolan', age: 54})")
    await conn.query("CREATE (m:Movie {title: 'Inception', year: 2010})")
    await conn.query("CREATE (m:Movie {title: 'Interstellar', year: 2014})")
    await conn.query(
      "MATCH (p:Person {name: 'Christopher Nolan'}), (m:Movie {title: 'Inception'}) CREATE (p)-[:DIRECTED]->(m)",
    )
    await conn.query(
      "MATCH (p:Person {name: 'Christopher Nolan'}), (m:Movie {title: 'Interstellar'}) CREATE (p)-[:DIRECTED]->(m)",
    )
  })

  afterAll(async () => {
    try {
      await fs.rm(testDbPath, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("Query execution", () => {
    it("should execute simple queries", async () => {
      const result = await conn.query("MATCH (p:Person) RETURN p.name as name, p.age as age")
      const rows = await result.getAll()
      result.close()

      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe("Christopher Nolan")
      expect(rows[0]?.age).toBe(54)
    })

    it("should execute relationship queries", async () => {
      const result = await conn.query(`
        MATCH (p:Person)-[:DIRECTED]->(m:Movie) 
        RETURN p.name as director, m.title as movie 
        ORDER BY m.year
      `)
      const rows = await result.getAll()
      result.close()

      expect(rows).toHaveLength(2)
      expect(rows[0]?.director).toBe("Christopher Nolan")
      expect(rows[0]?.movie).toBe("Inception")
      expect(rows[1]?.movie).toBe("Interstellar")
    })

    it("should handle aggregation queries", async () => {
      const result = await conn.query(`
        MATCH (p:Person)-[:DIRECTED]->(m:Movie) 
        RETURN p.name as director, count(m) as movie_count
      `)
      const rows = await result.getAll()
      result.close()

      expect(rows).toHaveLength(1)
      expect(rows[0]?.director).toBe("Christopher Nolan")
      expect(rows[0]?.movie_count).toBe(2)
    })
  })

  describe("Schema retrieval", () => {
    it("should get table information", async () => {
      const result = await conn.query("CALL show_tables() RETURN *")
      const tables = await result.getAll()
      result.close()

      interface TableInfo {
        name: string
        type: string
      }
      const nodeTableNames = (tables as unknown as TableInfo[])
        .filter((t) => t.type === "NODE")
        .map((t) => t.name)
        .sort()

      expect(nodeTableNames).toEqual(["Movie", "Person"])

      const relTableNames = (tables as unknown as TableInfo[]).filter((t) => t.type === "REL").map((t) => t.name)

      expect(relTableNames).toEqual(["DIRECTED"])
    })

    it("should get table properties", async () => {
      const result = await conn.query("CALL table_info('Person') RETURN *")
      const properties = await result.getAll()
      result.close()

      interface PropertyInfo {
        name: string
        type: string
        "primary key"?: boolean
      }
      const propNames = (properties as unknown as PropertyInfo[]).map((p) => p.name)
      expect(propNames).toContain("name")
      expect(propNames).toContain("age")

      const nameProp = (properties as unknown as PropertyInfo[]).find((p) => p.name === "name")
      expect(nameProp?.type).toBe("STRING")
      expect(nameProp?.["primary key"]).toBe(true)
    })

    it("should get relationship connectivity", async () => {
      const result = await conn.query("CALL show_connection('DIRECTED') RETURN *")
      const connectivity = await result.getAll()
      result.close()

      expect(connectivity).toHaveLength(1)
      expect(connectivity[0]?.["source table name"]).toBe("Person")
      expect(connectivity[0]?.["destination table name"]).toBe("Movie")
    })
  })

  describe("Error handling", () => {
    it("should handle syntax errors", async () => {
      try {
        await conn.query("INVALID CYPHER QUERY")
        expect.fail("Should have thrown an error")
      } catch (error) {
        expect(error).toBeDefined()
        expect((error as Error).message).toContain("Parser exception")
      }
    })

    it("should handle non-existent tables", async () => {
      try {
        await conn.query("MATCH (n:NonExistentTable) RETURN n")
        expect.fail("Should have thrown an error")
      } catch (error) {
        expect(error).toBeDefined()
        expect((error as Error).message).toContain("NonExistentTable")
      }
    })
  })

  describe("BigInt handling", () => {
    it("should handle BigInt values in results", async () => {
      // Create a table with large numbers
      await conn.query("CREATE NODE TABLE BigNumbers(id INT64, value INT64, PRIMARY KEY(id))")
      await conn.query("CREATE (n:BigNumbers {id: 1, value: 9007199254740992})") // Near MAX_SAFE_INTEGER

      const result = await conn.query("MATCH (n:BigNumbers) RETURN n.value as value")
      const rows = await result.getAll()
      result.close()

      // Note: Kuzu might return large numbers as regular numbers if they fit
      // For truly large numbers beyond MAX_SAFE_INTEGER, it would be bigint
      interface BigNumberResult {
        value: number | bigint
      }
      const value = (rows[0] as unknown as BigNumberResult).value
      expect(value).toBe(9007199254740992)

      // Test serialization
      const bigIntReplacer = (_: string, value: unknown): unknown => {
        if (typeof value === "bigint") {
          return value.toString()
        }
        return value
      }

      const json = JSON.stringify(rows[0], bigIntReplacer)
      const parsed = JSON.parse(json) as { value: number }
      expect(parsed.value).toBe(9007199254740992)
    })
  })
})
