# DuckDB R2 Manager - Implementation Plan (Library)

**Project**: `duckdb-r2-manager` (or `duckling`)
**Type**: npm package (TypeScript library)
**Goal**: Multi-tenant DuckDB manager with R2/S3 storage for Node.js applications
**Timeline**: 2-3 weeks

---

## Overview

Create a standalone TypeScript library for managing per-user DuckDB instances with cloud storage (R2/S3). This library can be used in any Node.js application and will also power the MCP server.

**Key Features:**
- Per-user database isolation
- R2/S3/MinIO storage support
- LRU caching with automatic eviction
- Multiple storage strategies (Parquet, DuckDB files, Hybrid)
- Connection pooling
- Full TypeScript support
- Promise-based API

---

## Phase 1: Project Initialization (Day 1)

### Tasks

1. **Create Repository**
```bash
mkdir duckdb-r2-manager
cd duckdb-r2-manager
git init
npm init -y
```

2. **Install Dependencies**
```bash
# Core
npm install @duckdb/node-api @duckdb/node-bindings

# Development
npm install -D typescript @types/node
npm install -D vitest @vitest/coverage-v8
npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install -D prettier

# Utilities
npm install debug
```

3. **Project Structure**
```
duckdb-r2-manager/
├── src/
│   ├── index.ts                    # Main exports
│   ├── UserDatabaseManager.ts      # Core manager class
│   ├── strategies/
│   │   ├── StorageStrategy.ts      # Interface
│   │   ├── ParquetStrategy.ts      # Parquet-based (default)
│   │   ├── DuckDBStrategy.ts       # .duckdb files (read-only)
│   │   └── HybridStrategy.ts       # Local + R2 sync
│   ├── cache/
│   │   ├── LRUCache.ts             # User cache implementation
│   │   └── CacheStats.ts           # Cache metrics
│   ├── connection/
│   │   ├── ConnectionPool.ts       # Connection management
│   │   └── ConnectionHealth.ts     # Health checks
│   ├── types.ts                    # TypeScript types
│   └── utils/
│       ├── errors.ts               # Custom error classes
│       ├── logger.ts               # Debug logging
│       └── metrics.ts              # Performance metrics
├── tests/
│   ├── unit/
│   ├── integration/
│   └── performance/
├── examples/
│   ├── express.ts
│   ├── fastify.ts
│   ├── nextjs.ts
│   ├── standalone.ts
│   └── multi-tenant.ts
├── docs/
│   ├── api/
│   ├── guides/
│   └── examples/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.json
├── .prettierrc
├── README.md
└── LICENSE
```

4. **TypeScript Configuration** (`tsconfig.json`)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

5. **Package.json Setup**
```json
{
  "name": "duckdb-r2-manager",
  "version": "1.0.0",
  "description": "Multi-tenant DuckDB manager with R2/S3 storage",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "dev": "tsup src/index.ts --format esm --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/**/*.ts",
    "format": "prettier --write src/**/*.ts",
    "typecheck": "tsc --noEmit"
  },
  "keywords": [
    "duckdb",
    "r2",
    "s3",
    "cloudflare",
    "multi-tenant",
    "database",
    "typescript"
  ],
  "author": "Your Name",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/duckdb-r2-manager"
  }
}
```

### Deliverables
- [ ] Repository created with clean structure
- [ ] TypeScript build pipeline working
- [ ] Test runner configured
- [ ] ESLint and Prettier setup

---

## Phase 2: Core Manager Implementation (Days 2-5)

### Tasks

1. **Define Types** (`src/types.ts`)
```typescript
export interface ManagerConfig {
  // R2/S3 Configuration
  r2?: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
  s3?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };

  // DuckDB Settings
  memoryLimit?: string;  // Default: '4GB'
  threads?: number;      // Default: 4

  // Cache Settings
  maxActiveUsers?: number;        // Default: 10
  evictionTimeout?: number;       // Default: 300000 (5 min)
  cacheType?: 'disk' | 'memory' | 'noop';  // Default: 'disk'
  cacheDir?: string;             // Default: '/tmp/duckdb-cache'

  // Storage Strategy
  strategy?: 'parquet' | 'duckdb' | 'hybrid';  // Default: 'parquet'
}

export interface UserDatabase {
  userId: string;
  connection: any;  // DuckDBConnection
  lastAccess: Date;
  attached: boolean;
  memoryUsage?: number;
}

export interface UserStats {
  userId: string;
  attached: boolean;
  lastAccess: Date;
  memoryUsage: number;
  storageUsage: number;
  queryCount: number;
}

export interface Schema {
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
    }>;
  }>;
}

export interface CreateUserOptions {
  template?: string;
  initialData?: Record<string, any[]>;
}

export interface StorageStats {
  totalSize: number;
  fileCount: number;
  lastModified: Date;
}
```

2. **Custom Errors** (`src/utils/errors.ts`)
```typescript
export class DuckDBManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuckDBManagerError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class R2ConnectionError extends DuckDBManagerError {
  constructor(message: string) {
    super(message);
    this.name = 'R2ConnectionError';
  }
}

export class UserNotFoundError extends DuckDBManagerError {
  constructor(userId: string) {
    super(`User database not found: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

export class QueryExecutionError extends DuckDBManagerError {
  constructor(message: string, public readonly query: string) {
    super(`Query execution failed: ${message}`);
    this.name = 'QueryExecutionError';
  }
}

export class MemoryLimitExceededError extends DuckDBManagerError {
  constructor() {
    super('Memory limit exceeded');
    this.name = 'MemoryLimitExceededError';
  }
}

export class StorageError extends DuckDBManagerError {
  constructor(message: string) {
    super(`Storage operation failed: ${message}`);
    this.name = 'StorageError';
  }
}
```

3. **LRU Cache** (`src/cache/LRUCache.ts`)
```typescript
import { UserDatabase } from '../types';

export class LRUCache<T extends UserDatabase> {
  private cache: Map<string, T>;
  private maxSize: number;

  constructor(maxSize: number = 10) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const item = this.cache.get(key);
    if (item) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, item);
      item.lastAccess = new Date();
    }
    return item;
  }

  set(key: string, value: T): void {
    // Remove if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    value.lastAccess = new Date();
    this.cache.set(key, value);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  getLRU(): string | undefined {
    return this.cache.keys().next().value;
  }

  getStale(timeout: number): string[] {
    const now = Date.now();
    const stale: string[] = [];

    for (const [key, value] of this.cache.entries()) {
      const age = now - value.lastAccess.getTime();
      if (age > timeout) {
        stale.push(key);
      }
    }

    return stale;
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  values(): IterableIterator<T> {
    return this.cache.values();
  }
}
```

4. **Core Manager** (`src/UserDatabaseManager.ts`)
```typescript
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { LRUCache } from './cache/LRUCache';
import {
  ManagerConfig,
  UserDatabase,
  UserStats,
  Schema,
  CreateUserOptions
} from './types';
import {
  R2ConnectionError,
  UserNotFoundError,
  QueryExecutionError
} from './utils/errors';
import { createLogger } from './utils/logger';

const log = createLogger('UserDatabaseManager');

export class UserDatabaseManager {
  private instance!: DuckDBInstance;
  private cache: LRUCache<UserDatabase>;
  private config: Required<ManagerConfig>;
  private evictionTimer?: NodeJS.Timeout;
  private initialized = false;

  constructor(config: ManagerConfig) {
    // Set defaults
    this.config = {
      memoryLimit: config.memoryLimit || '4GB',
      threads: config.threads || 4,
      maxActiveUsers: config.maxActiveUsers || 10,
      evictionTimeout: config.evictionTimeout || 300000,
      cacheType: config.cacheType || 'disk',
      cacheDir: config.cacheDir || '/tmp/duckdb-cache',
      strategy: config.strategy || 'parquet',
      ...config
    };

    this.cache = new LRUCache(this.config.maxActiveUsers);
  }

  async init(): Promise<void> {
    if (this.initialized) {
      log('Already initialized');
      return;
    }

    log('Initializing DuckDB instance');

    // Create in-memory instance
    this.instance = await DuckDBInstance.create(':memory:');

    // Setup R2/S3 access
    await this.setupCloudStorage();

    // Start eviction timer
    this.startEvictionTimer();

    this.initialized = true;
    log('Initialization complete');
  }

  private async setupCloudStorage(): Promise<void> {
    const conn = await this.instance.connect();

    try {
      // Create secret for R2 or S3
      if (this.config.r2) {
        log('Configuring R2 access');
        await conn.run(`
          CREATE SECRET r2_secret (
            TYPE R2,
            ACCOUNT_ID '${this.config.r2.accountId}',
            ACCESS_KEY_ID '${this.config.r2.accessKeyId}',
            SECRET_ACCESS_KEY '${this.config.r2.secretAccessKey}'
          );
        `);
      } else if (this.config.s3) {
        log('Configuring S3 access');
        await conn.run(`
          CREATE SECRET s3_secret (
            TYPE S3,
            REGION '${this.config.s3.region}',
            ACCESS_KEY_ID '${this.config.s3.accessKeyId}',
            SECRET_ACCESS_KEY '${this.config.s3.secretAccessKey}'
          );
        `);
      }

      // Install extensions
      await conn.run(`
        INSTALL httpfs;
        LOAD httpfs;
        INSTALL cache_httpfs;
        LOAD cache_httpfs;
      `);

      // Configure cache and performance
      await conn.run(`
        SET cache_httpfs_type='${this.config.cacheType}';
        SET memory_limit='${this.config.memoryLimit}';
        SET threads=${this.config.threads};
      `);

      log('Cloud storage configured');
    } catch (error) {
      throw new R2ConnectionError(`Failed to setup cloud storage: ${error}`);
    } finally {
      await conn.close();
    }
  }

  async getUserConnection(userId: string): Promise<DuckDBConnection> {
    this.ensureInitialized();

    // Check cache
    const cached = this.cache.get(userId);
    if (cached) {
      log(`Using cached connection for user: ${userId}`);
      return cached.connection;
    }

    log(`Loading database for user: ${userId}`);

    // Evict if at capacity
    if (this.cache.size() >= this.config.maxActiveUsers) {
      await this.evictLRU();
    }

    // Create new connection
    const conn = await this.instance.connect();

    // Attach user's database (strategy-dependent)
    await this.attachUserDatabase(conn, userId);

    // Add to cache
    this.cache.set(userId, {
      userId,
      connection: conn,
      lastAccess: new Date(),
      attached: true
    });

    log(`Loaded database for user: ${userId}`);
    return conn;
  }

  private async attachUserDatabase(
    conn: DuckDBConnection,
    userId: string
  ): Promise<void> {
    const bucket = this.config.r2?.bucket || this.config.s3?.bucket;
    const protocol = this.config.r2 ? 'r2' : 's3';

    if (this.config.strategy === 'duckdb') {
      // Attach .duckdb file (read-only)
      const dbPath = `${protocol}://${bucket}/users/${userId}/database.duckdb`;
      await conn.run(`ATTACH '${dbPath}' AS user_${userId} (READ_ONLY);`);
    } else if (this.config.strategy === 'parquet') {
      // Parquet files don't need explicit attach
      // Will query directly with read_parquet()
    }
  }

  async detachUser(userId: string): Promise<void> {
    const cached = this.cache.get(userId);
    if (!cached) {
      log(`User not attached: ${userId}`);
      return;
    }

    log(`Detaching user: ${userId}`);

    try {
      if (this.config.strategy === 'duckdb') {
        await cached.connection.run(`DETACH user_${userId}`);
      }
      await cached.connection.close();
    } catch (error) {
      log(`Error detaching user ${userId}: ${error}`);
    }

    this.cache.delete(userId);
    log(`Detached user: ${userId}`);
  }

  private async evictLRU(): Promise<void> {
    const lruUserId = this.cache.getLRU();
    if (lruUserId) {
      log(`Evicting LRU user: ${lruUserId}`);
      await this.detachUser(lruUserId);
    }
  }

  private startEvictionTimer(): void {
    this.evictionTimer = setInterval(async () => {
      const staleUsers = this.cache.getStale(this.config.evictionTimeout);

      for (const userId of staleUsers) {
        log(`Evicting idle user: ${userId}`);
        await this.detachUser(userId);
      }
    }, 60000); // Check every minute

    // Don't keep process alive for timer
    this.evictionTimer.unref();
  }

  async query(userId: string, sql: string): Promise<any[]> {
    const conn = await this.getUserConnection(userId);

    try {
      const result = await conn.run(sql);
      return result.toArray();
    } catch (error) {
      throw new QueryExecutionError(String(error), sql);
    }
  }

  async execute(userId: string, sql: string): Promise<void> {
    const conn = await this.getUserConnection(userId);
    await conn.run(sql);
  }

  async batch(userId: string, queries: string[]): Promise<any[]> {
    const conn = await this.getUserConnection(userId);
    const results: any[] = [];

    for (const sql of queries) {
      const result = await conn.run(sql);
      results.push(result.toArray());
    }

    return results;
  }

  async writeParquet(
    userId: string,
    table: string,
    data: any[]
  ): Promise<void> {
    const conn = await this.getUserConnection(userId);
    const bucket = this.config.r2?.bucket || this.config.s3?.bucket;
    const protocol = this.config.r2 ? 'r2' : 's3';
    const path = `${protocol}://${bucket}/users/${userId}/data/${table}.parquet`;

    // Create temp table
    await conn.run(`CREATE TEMP TABLE temp_${table} AS SELECT * FROM ?`, [data]);

    // Export to R2
    await conn.run(`
      COPY temp_${table}
      TO '${path}'
      (FORMAT PARQUET, COMPRESSION ZSTD)
    `);

    log(`Wrote ${data.length} rows to ${path}`);
  }

  async readParquet(userId: string, pattern: string): Promise<any[]> {
    const conn = await this.getUserConnection(userId);
    const bucket = this.config.r2?.bucket || this.config.s3?.bucket;
    const protocol = this.config.r2 ? 'r2' : 's3';
    const path = `${protocol}://${bucket}/users/${userId}/${pattern}`;

    const result = await conn.run(`SELECT * FROM read_parquet('${path}')`);
    return result.toArray();
  }

  async exportToParquet(
    userId: string,
    query: string,
    path: string
  ): Promise<void> {
    const conn = await this.getUserConnection(userId);
    const bucket = this.config.r2?.bucket || this.config.s3?.bucket;
    const protocol = this.config.r2 ? 'r2' : 's3';
    const fullPath = `${protocol}://${bucket}/users/${userId}/${path}`;

    await conn.run(`
      COPY (${query})
      TO '${fullPath}'
      (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  }

  async createUser(userId: string, options?: CreateUserOptions): Promise<void> {
    log(`Creating user: ${userId}`);

    // Create initial metadata
    const metadata = [{
      userId,
      createdAt: new Date(),
      template: options?.template || 'default'
    }];

    await this.writeParquet(userId, 'metadata', metadata);

    // Write initial data if provided
    if (options?.initialData) {
      for (const [table, data] of Object.entries(options.initialData)) {
        await this.writeParquet(userId, table, data);
      }
    }

    log(`Created user: ${userId}`);
  }

  async deleteUser(userId: string): Promise<void> {
    log(`Deleting user: ${userId}`);

    // Detach if loaded
    await this.detachUser(userId);

    // TODO: Delete files from R2/S3
    // This requires listing and deleting all user files

    log(`Deleted user: ${userId}`);
  }

  async getUserSchema(userId: string): Promise<Schema> {
    const conn = await this.getUserConnection(userId);
    const bucket = this.config.r2?.bucket || this.config.s3?.bucket;
    const protocol = this.config.r2 ? 'r2' : 's3';

    // List Parquet files
    const files = await conn.run(`
      SELECT filename
      FROM glob('${protocol}://${bucket}/users/${userId}/data/*.parquet')
    `);

    const schema: Schema = { tables: [] };

    for (const file of files.toArray()) {
      const tableName = file.filename.split('/').pop()?.replace('.parquet', '');
      const columns = await conn.run(`
        DESCRIBE SELECT * FROM read_parquet('${file.filename}')
      `);

      schema.tables.push({
        name: tableName!,
        columns: columns.toArray().map(col => ({
          name: col.column_name,
          type: col.column_type
        }))
      });
    }

    return schema;
  }

  async getUserStats(userId: string): Promise<UserStats> {
    const cached = this.cache.get(userId);

    return {
      userId,
      attached: cached?.attached || false,
      lastAccess: cached?.lastAccess || new Date(0),
      memoryUsage: cached?.memoryUsage || 0,
      storageUsage: 0, // TODO: Calculate from R2
      queryCount: 0 // TODO: Track queries
    };
  }

  async close(): Promise<void> {
    log('Closing manager');

    // Stop eviction timer
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
    }

    // Detach all users
    for (const userDb of this.cache.values()) {
      await this.detachUser(userDb.userId);
    }

    // Close instance
    await this.instance.close();

    this.initialized = false;
    log('Manager closed');
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Manager not initialized. Call init() first.');
    }
  }
}
```

5. **Logger Utility** (`src/utils/logger.ts`)
```typescript
import debug from 'debug';

export function createLogger(namespace: string) {
  const log = debug(`duckdb-r2:${namespace}`);
  return log;
}
```

### Deliverables
- [ ] Core manager class implemented
- [ ] LRU cache working
- [ ] R2/S3 configuration complete
- [ ] Unit tests passing (>80% coverage)

---

## Phase 3: Storage Strategies (Days 6-8)

### Tasks

1. **Strategy Interface** (`src/strategies/StorageStrategy.ts`)
```typescript
import { DuckDBConnection } from '@duckdb/node-api';
import { StorageStats } from '../types';

export interface StorageStrategy {
  name: string;

  /**
   * Execute a query for a user
   */
  query(
    conn: DuckDBConnection,
    userId: string,
    sql: string
  ): Promise<any[]>;

  /**
   * Write data to storage
   */
  write(
    conn: DuckDBConnection,
    userId: string,
    table: string,
    data: any[]
  ): Promise<void>;

  /**
   * Sync local changes to remote (if applicable)
   */
  sync(
    conn: DuckDBConnection,
    userId: string
  ): Promise<void>;

  /**
   * Get storage statistics
   */
  getStats(
    conn: DuckDBConnection,
    userId: string
  ): Promise<StorageStats>;
}
```

2. **Parquet Strategy** (default)
```typescript
import { StorageStrategy } from './StorageStrategy';
// Implementation similar to writeParquet/readParquet in manager
```

3. **DuckDB Strategy** (read-only .duckdb files)
```typescript
import { StorageStrategy } from './StorageStrategy';
// Implementation using ATTACH for .duckdb files
```

4. **Hybrid Strategy** (local + R2 sync)
```typescript
import { StorageStrategy } from './StorageStrategy';
// Implementation with local cache and periodic R2 sync
```

### Deliverables
- [ ] Three strategy implementations
- [ ] Strategy tests with MinIO
- [ ] Strategy selection logic

---

## Phase 4: Advanced Features (Days 9-11)

### Tasks

1. **Connection Pool**
2. **Cache Statistics**
3. **Metrics & Monitoring**
4. **Event Emitter**

### Deliverables
- [ ] Advanced features implemented
- [ ] Documentation complete

---

## Phase 5: Testing (Days 12-14)

### Comprehensive test suite with >85% coverage

### Deliverables
- [ ] All tests passing
- [ ] Coverage report generated

---

## Phase 6: Developer Experience (Days 15-16)

### Tasks

1. **Examples**
2. **TypeScript Types**
3. **Error Handling**
4. **Debug Logging**

### Deliverables
- [ ] Working examples
- [ ] Full type definitions

---

## Phase 7: Documentation (Days 17-19)

### Complete documentation site

### Deliverables
- [ ] README.md
- [ ] API documentation
- [ ] Usage guides

---

## Phase 8: Publishing (Days 20-21)

### Tasks

1. **Prepare Package**
2. **GitHub Repository**
3. **Publish to npm**
4. **Announcements**

### Deliverables
- [ ] Published to npm
- [ ] GitHub release created
- [ ] Community announcements

---

## Success Criteria

- [ ] Clean TypeScript API
- [ ] All storage strategies working
- [ ] Test coverage >85%
- [ ] Published to npm
- [ ] Documentation complete
- [ ] At least 3 working examples

---

## Timeline Summary

| Week | Focus |
|------|-------|
| **Week 1** | Setup, Core Manager, Strategies |
| **Week 2** | Features, Testing |
| **Week 3** | DX, Docs, Publishing |

**Total Estimate**: 2-3 weeks

---

## Next Steps

After publishing:
1. Use in MCP server (Plan A)
2. Monitor npm downloads
3. Respond to issues
4. Add community features
