// Mock implementation of kuzu for testing
import * as fsSync from "fs"
import * as path from "path"

export class Database {
  public initPromise?: Promise<void>

  constructor(
    public dbPath: string,
    public bufferPoolSize = 0,
    public readonly = false,
    public compress = true,
  ) {
    // Create mock database files synchronously to avoid race conditions
    if (!readonly) {
      const fullPath = path.resolve(dbPath)
      // Create directory synchronously
      fsSync.mkdirSync(fullPath, { recursive: true })
      fsSync.writeFileSync(path.join(fullPath, "catalog.kz"), "mock catalog")
      fsSync.writeFileSync(path.join(fullPath, "data.kz"), "mock data")
    }
  }
}

export class Connection {
  constructor(public db: Database) {}

  query(cypher: string): Promise<{
    getAll: () => Promise<Record<string, unknown>[]>
    close: () => void
  }> {
    // Mock different query responses
    if (cypher.includes("CALL show_tables()")) {
      return Promise.resolve({
        getAll: () =>
          Promise.resolve([
            { name: "Person", type: "NODE", comment: "" },
            { name: "Movie", type: "NODE", comment: "" },
            { name: "DIRECTED", type: "REL", comment: "" },
          ]),
        close: () => {},
      })
    }

    if (cypher.includes("CALL table_info(")) {
      const tableName = cypher.match(/CALL table_info\('(.+?)'\)/)?.[1]
      if (tableName === "Person") {
        return Promise.resolve({
          getAll: () =>
            Promise.resolve([
              { name: "name", type: "STRING", "primary key": true },
              { name: "age", type: "INT64", "primary key": false },
            ]),
          close: () => {},
        })
      }
    }

    if (cypher.includes("CALL show_connection(")) {
      return Promise.resolve({
        getAll: () => Promise.resolve([{ "source table name": "Person", "destination table name": "Movie" }]),
        close: () => {},
      })
    }

    if (cypher.includes("MATCH (p:Person) RETURN")) {
      return Promise.resolve({
        getAll: () => Promise.resolve([{ name: "Christopher Nolan", age: 54 }]),
        close: () => {},
      })
    }

    if (cypher.includes("MATCH (p:Person)-[:DIRECTED]->(m:Movie)")) {
      if (cypher.includes("count(m)")) {
        return Promise.resolve({
          getAll: () => Promise.resolve([{ director: "Christopher Nolan", movie_count: 2 }]),
          close: () => {},
        })
      }
      return Promise.resolve({
        getAll: () =>
          Promise.resolve([
            { director: "Christopher Nolan", movie: "Inception" },
            { director: "Christopher Nolan", movie: "Interstellar" },
          ]),
        close: () => {},
      })
    }

    if (cypher === "RETURN 1 as test") {
      return Promise.resolve({
        getAll: () => Promise.resolve([{ test: 1 }]),
        close: () => {},
      })
    }

    if (cypher.includes("INVALID CYPHER")) {
      throw new Error("Parser exception: Invalid Cypher query")
    }

    if (cypher.includes("NonExistentTable")) {
      throw new Error("Table NonExistentTable does not exist")
    }

    if (cypher.includes("MATCH (n:BigNumbers) RETURN")) {
      return Promise.resolve({
        getAll: () => Promise.resolve([{ value: 9007199254740992 }]),
        close: () => {},
      })
    }

    if (cypher.includes("MATCH (n:TestNode) RETURN n.name")) {
      return Promise.resolve({
        getAll: () => Promise.resolve([{ name: "test" }]),
        close: () => {},
      })
    }

    if (cypher.includes("count")) {
      return Promise.resolve({
        getAll: () => Promise.resolve([{ count: 0 }]),
        close: () => {},
      })
    }

    // Default response for CREATE, INSERT operations
    return Promise.resolve({
      getAll: () => Promise.resolve([]),
      close: () => {},
    })
  }
}
