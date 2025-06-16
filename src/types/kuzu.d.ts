declare module "kuzu" {
  export class Database {
    constructor(dbPath: string, bufferPoolSize?: number, enableCompression?: boolean, readOnly?: boolean)
  }

  export class Connection {
    constructor(database: Database)
    query(cypher: string): Promise<QueryResult>
  }

  export class QueryResult {
    getAll(): Promise<Record<string, unknown>[]>
    close(): void
  }
}
