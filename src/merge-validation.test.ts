import { describe, it, expect } from "vitest"
import { extractMergeStatements, convertMergeToSafePattern } from "./merge-validation"

describe("extractMergeStatements", () => {
  it("should extract simple MERGE statements", () => {
    const query = "MERGE (n:Person {name: 'John', age: 30})"
    const statements = extractMergeStatements(query)

    expect(statements).toHaveLength(1)
    expect(statements[0]).toEqual({
      label: "Person",
      properties: ["name", "age"],
    })
  })

  it("should extract multiple MERGE statements", () => {
    const query = `
      MERGE (p:Person {name: 'John'})
      MERGE (c:Company {name: 'Acme', founded: 2020})
    `
    const statements = extractMergeStatements(query)

    expect(statements).toHaveLength(2)
    expect(statements[0]).toEqual({
      label: "Person",
      properties: ["name"],
    })
    expect(statements[1]).toEqual({
      label: "Company",
      properties: ["name", "founded"],
    })
  })

  it("should extract properties from MERGE with SET", () => {
    const query = `
      MERGE (n:Person {id: 123})
      SET n.name = 'John',
          n.age = 30,
          n.city = 'NYC'
    `
    const statements = extractMergeStatements(query)

    expect(statements).toHaveLength(1)
    expect(statements[0]).toEqual({
      label: "Person",
      properties: ["id", "name", "age", "city"],
    })
  })

  it("should handle complex property values", () => {
    const query = `
      MERGE (role:Role {title: 'Co-founder and CTO'})
      SET role.company = 'cQuenced',
          role.years_experience = 25,
          role.confidence_score = 0.9,
          role.auto_refresh_interval_days = 30
    `
    const statements = extractMergeStatements(query)

    expect(statements).toHaveLength(1)
    expect(statements[0]).toEqual({
      label: "Role",
      properties: ["title", "company", "years_experience", "confidence_score", "auto_refresh_interval_days"],
    })
  })

  it("should handle empty queries", () => {
    const statements = extractMergeStatements("")
    expect(statements).toHaveLength(0)
  })

  it("should ignore non-MERGE statements", () => {
    const query = "MATCH (n:Person) WHERE n.name = 'John' RETURN n"
    const statements = extractMergeStatements(query)
    expect(statements).toHaveLength(0)
  })
})

describe("convertMergeToSafePattern", () => {
  it("should convert MERGE to CREATE OR REPLACE", () => {
    const query = "MERGE (n:Person {id: 123, name: 'John'})"
    const converted = convertMergeToSafePattern(query)

    expect(converted).toBe("CREATE OR REPLACE (n:Person {id: 123, name: 'John'})")
  })

  it("should handle multiple MERGE statements", () => {
    const query = `
      MERGE (p:Person {id: 1})
      MERGE (c:Company {id: 2})
    `
    const converted = convertMergeToSafePattern(query)

    expect(converted).toContain("CREATE OR REPLACE (p:Person {id: 1})")
    expect(converted).toContain("CREATE OR REPLACE (c:Company {id: 2})")
  })

  it("should preserve other parts of the query", () => {
    const query = `
      MATCH (p:Person)
      MERGE (c:Company {name: p.company})
      RETURN c
    `
    const converted = convertMergeToSafePattern(query)

    expect(converted).toContain("MATCH (p:Person)")
    expect(converted).toContain("CREATE OR REPLACE (c:Company {name: p.company})")
    expect(converted).toContain("RETURN c")
  })
})
